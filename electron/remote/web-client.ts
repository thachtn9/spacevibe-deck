import type { createWebTerminal } from "./web-terminal";
/// <reference lib="dom" />
import type { CliQuotaSnapshot } from "../../src/lib/cli-manager-quota";
import type { RemoteScreen, RemoteSession } from "../../src/lib/deck-remote";

/** Serialized as an external script; keep every runtime dependency inside this function. */
export function bootRemoteWeb() {
  type Screen = RemoteScreen & { session: RemoteSession };
  type Mutation = { key: string; body: string };
  type Draft = { text: string; note: string; pending?: Mutation; review?: boolean };
  type Folders = {
    root: string;
    path: string;
    parent: string | null;
    entries: { name: string; path: string }[];
    truncated: boolean;
  };
  type Quota = { snapshot: CliQuotaSnapshot | null; stale: boolean; error: string | null };
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") => {
    const result = document.createElement(tag);
    result.className = className;
    result.textContent = text;
    return result;
  };
  function icon(
    name:
      | "X"
      | "Plus"
      | "Terminal"
      | "Folder"
      | "CaretRight"
      | "ArrowElbowDownLeft"
      | "ArrowClockwise"
      | "DotsThree",
    size = 20,
  ) {
    const result = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    result.setAttribute("class", "icon");
    result.setAttribute("width", String(size));
    result.setAttribute("height", String(size));
    result.setAttribute("viewBox", "0 0 256 256");
    result.setAttribute("fill", "currentColor");
    result.setAttribute("aria-hidden", "true");
    result.setAttribute("focusable", "false");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#remote-${name}`);
    result.append(use);
    return result;
  }
  const connection = el<HTMLInputElement>("connection");
  const composer = el<HTMLTextAreaElement>("instruction");
  const send = el<HTMLButtonElement>("send");
  const agent = el<HTMLSelectElement>("agent");
  const account = el<HTMLSelectElement>("account");
  const terminal = el<HTMLPreElement>("screen");
  const menu = el<HTMLDetailsElement>("remote-menu");
  const drafts = new Map<string, Draft>();
  const collapsedFolders = new Set<string>();
  const rememberedFolders = new Set<string>();
  const closing = new Set<string>();
  const pendingCloses = new Map<string, Mutation>();
  const preferencesKey = "deck-remote.workspace.v2";
  let independent = false;
  let restoreView = true;
  let preferences: {
    selected?: string | null;
    secondary?: string | null;
    collapsed?: string[];
    folders?: string[];
  } = {};
  function savePreferences() {
    if (!independent) return;
    preferences = {
      selected,
      secondary: workspace.sessionIds()[1] ?? null,
      collapsed: [...collapsedFolders],
      folders: [...rememberedFolders],
    };
    try {
      localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    } catch {
      /* Current-page workspace still works without browser storage. */
    }
  }

  const sending = new Set<string>();
  const controllers = new Set<AbortController>();
  const storageKey = "deck-remote.connection.v1";
  let token = "";
  let epoch = 0;
  let online = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollingEpoch: number | null = null;
  let sessions: RemoteSession[] = [];
  let sessionSignature = "";
  let selected: string | null = null;
  let viewed: Screen | null = null;
  let screenSignature = "";
  let view: "sessions" | "quota" | "new" = "sessions";
  let root = "";
  let folders: Folders | null = null;
  let folderRequest = 0;
  let folderLoading = false;
  let quota: Quota | null = null;
  let quotaAt = 0;
  let quotaBusy = false;
  let creating = false;
  let pendingCreate: Mutation | null = null;

  const workspace = (
    window as unknown as { createDeckTerminal: typeof createWebTerminal }
  ).createDeckTerminal({
    root: el("web-terminals"),
    token: () => token,
    sessions: () => sessions,
    onSecondaryChange: () => savePreferences(),
    mutate: (id, body) => api(`/v1/sessions/${encodeURIComponent(id)}/terminal`, mutation(body)),
  });

  function message(cause: unknown) {
    return cause instanceof Error ? cause.message : "Deck could not complete the request.";
  }
  function notice(text = "") {
    el("app-error").textContent = text;
    el("app-error").hidden = !text;
  }
  function network(connected: boolean) {
    online = connected;
    const status = el("network-status");
    status.dataset.online = String(connected);
    el("network-label").textContent = connected ? "Connected" : "Disconnected";
    el("network-time").textContent = connected
      ? `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Showing last update";
    renderDraft();
  }
  function savedToken(value?: string) {
    try {
      if (value === undefined) return localStorage.getItem(storageKey) ?? "";
      if (value) localStorage.setItem(storageKey, value);
      else localStorage.removeItem(storageKey);
    } catch {
      // Safari can deny storage; a connection still works for the current page.
    }
    return "";
  }
  function cancelRequests() {
    epoch++;
    clearTimeout(timer);
    for (const controller of controllers) controller.abort();
    controllers.clear();
  }
  async function api<T>(path: string, action?: Mutation): Promise<T> {
    const started = epoch;
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 28_000);
    try {
      const response = await fetch(path, {
        method: action ? "POST" : "GET",
        mode: "same-origin",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(action ? { "Content-Type": "application/json", "Idempotency-Key": action.key } : {}),
        },
        body: action?.body,
        signal: controller.signal,
      });
      const result = await response.json();
      if (started !== epoch) throw new Error("The connection changed.");
      if (!response.ok) throw new Error(result.error ?? `Deck returned ${response.status}.`);
      return result as T;
    } catch (cause) {
      if (cause instanceof TypeError || controller.signal.aborted)
        throw new Error("Could not reach Deck. Keep your computer running and check the network.", {
          cause,
        });
      throw cause;
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  function mutation(body: unknown): Mutation {
    // randomUUID needs HTTPS on Safari; getRandomValues also works on a private HTTP LAN.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { key: `${Date.now()}-${random}`, body: JSON.stringify(body) };
  }
  function draft(id: string) {
    let result = drafts.get(id);
    if (!result) {
      result = { text: "", note: "" };
      drafts.set(id, result);
    }
    return result;
  }
  function agentName(value: string | null) {
    return value === "codex" ? "Codex" : value === "agy" ? "AGY" : "Shell";
  }
  function sessionMeta(session: RemoteSession) {
    return [agentName(session.agentId), session.account].filter(Boolean).join(" · ");
  }
  function sessionState(session: RemoteSession) {
    if (session.phase === "exited") return { state: "exited", label: "Ended" };
    const attention: Record<string, string> = {
      requested: "Needs input",
      completed: "Completed",
      warning: "Warning",
      error: "Error",
    };
    if (attention[session.attention])
      return { state: session.attention, label: attention[session.attention] };
    return {
      state: session.phase,
      label:
        session.phase === "working"
          ? "Working"
          : session.phase === "idle"
            ? "Idle"
            : "Status unknown",
    };
  }
  function statusBadge(session: RemoteSession) {
    const status = sessionState(session);
    const result = make("span", "status-badge", status.label);
    result.dataset.state = status.state;
    return result;
  }
  function renderDraft() {
    if (!selected) return;
    const current = draft(selected);
    if (composer.value !== current.text) composer.value = current.text;
    const rows = Math.min(4, current.text.split("\n").length);
    if (composer.rows !== rows) composer.rows = rows;
    const busy = sending.has(selected);
    composer.disabled = busy || !!current.pending;
    el("input-form").dataset.state = busy
      ? "sending"
      : current.pending
        ? "error"
        : current.review
          ? "review"
          : "ready";
    el("input-note").textContent = current.note;
    el("edit-input").hidden = !current.pending || busy;
    const label = busy
      ? "Sending…"
      : current.pending
        ? "Retry send"
        : current.text
          ? "Send"
          : "Enter";
    send.setAttribute("aria-label", label);
    send.title = label;
    const glyph = busy ? "DotsThree" : current.pending ? "ArrowClockwise" : "ArrowElbowDownLeft";
    if (send.dataset.icon !== glyph) {
      send.replaceChildren(icon(glyph, 18));
      send.dataset.icon = glyph;
    }
    send.disabled =
      busy ||
      !online ||
      new TextEncoder().encode(current.text).length > 32_768 ||
      (!current.pending && (!viewed?.alive || viewed.session.id !== selected));
  }
  function showView(next: typeof view) {
    menu.open = false;
    view = next;
    const split = el<HTMLButtonElement>("split-terminal");
    split.hidden = split.disabled = next !== "sessions" || !selected || sessions.length < 2;
    workspace.suspend(next !== "sessions");
    if (next === "sessions") {
      workspace.open(sessions.find((row) => row.id === selected) ?? null);
      if (preferences.selected === selected) workspace.secondary(preferences.secondary ?? null);
    }
    el("sessions-view").hidden = next !== "sessions";
    el("quota-view").hidden = next !== "quota";
    el("new-view").hidden = next !== "new";
    el("nav-sessions").setAttribute("aria-pressed", String(next !== "quota"));
    el("nav-quota").setAttribute("aria-pressed", String(next === "quota"));
    el("app-view").dataset.view = next;
    el("workspace-session").textContent =
      next === "new"
        ? "New session"
        : next === "quota"
          ? "Quota"
          : (sessions.find((row) => row.id === selected)?.title ?? "Sessions");
  }
  function selectSession(id: string | null) {
    selected = id;
    workspace.open(sessions.find((row) => row.id === id) ?? null);
    viewed = null;
    terminal.textContent = "";
    screenSignature = "";
    el("screen-status").textContent = "Reading screen…";
    el("screen-status").dataset.state = "loading";
    el("session-detail").hidden = id === null;
    el("select-session").hidden = id !== null;
    el("sessions-view").dataset.detail = String(id !== null);
    el("app-view").dataset.detail = String(id !== null);
    showView("sessions");
    renderSessions();
    renderDraft();
    savePreferences();
    void poll();
  }
  function renderSessions() {
    workspace.refresh();
    const list = el("session-list");
    const query = el<HTMLInputElement>("search").value.toLocaleLowerCase();
    const visible = sessions.filter((session) =>
      [session.title, session.path, session.agentId, session.account]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
    list.replaceChildren();
    list.setAttribute("aria-busy", "false");
    el("session-count").textContent = String(sessions.length);
    for (const path of [
      ...new Set([
        ...visible.map((session) => session.path ?? "Other sessions"),
        ...[...rememberedFolders].filter(
          (path) => !query || path.toLocaleLowerCase().includes(query),
        ),
      ]),
    ].sort()) {
      const rows = visible.filter((row) => (row.path ?? "Other sessions") === path);
      const heading = make("div", "folder-group");
      const folder = make("button", "folder-toggle");
      folder.type = "button";
      const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
      const collapsed = collapsedFolders.has(path) && !query;
      folder.setAttribute("aria-expanded", String(!collapsed));
      folder.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} folder ${name}`);
      folder.title = path;
      folder.append(icon("CaretRight", 12), icon("Folder", 14), make("span", "", name));
      folder.addEventListener("click", () => {
        if (collapsedFolders.has(path)) collapsedFolders.delete(path);
        else collapsedFolders.add(path);
        renderSessions();
        savePreferences();
      });
      heading.append(folder);
      list.append(heading);
      for (const session of collapsed ? [] : rows) {
        const row = make("div", "session-row");
        const open = make("button", "session-open");
        open.type = "button";
        open.setAttribute("aria-label", `Open ${session.title}`);
        open.setAttribute("aria-current", String(session.id === selected));
        row.setAttribute("aria-current", String(session.id === selected));
        row.dataset.shell = String(!session.agentId && !session.account);
        row.dataset.attention = String(!!session.attention && session.attention !== "none");
        const copy = make("span", "session-copy");
        const caption = make("span", "session-caption");
        caption.append(make("span", "session-account", sessionMeta(session)));
        row.title = [session.title, sessionMeta(session), sessionState(session).label].join(" · ");
        copy.append(make("strong", "", session.title), caption);
        const state = statusBadge(session);
        state.classList.add("session-status");
        state.setAttribute("aria-label", sessionState(session).label);
        open.append(icon("Terminal", 15), copy, state);
        open.addEventListener("click", () => selectSession(session.id));
        row.append(open);
        if (independent) {
          const close = make("button", "session-close");
          close.append(icon("X", 12));
          close.type = "button";
          close.title = `Close ${session.title}`;
          close.setAttribute("aria-label", `Close ${session.title}`);
          close.disabled = closing.has(session.id);
          close.addEventListener("click", () => void closeSession(session));
          row.append(close);
        }
        list.append(row);
      }
    }
    if (!visible.length)
      list.append(
        make(
          "p",
          "empty",
          query
            ? "No matching sessions. Try another search."
            : independent
              ? "No remote sessions yet. Choose a folder to open a terminal."
              : "No running sessions. Open one on your computer or start a new session here.",
        ),
      );
    const split = el<HTMLButtonElement>("split-terminal");
    split.hidden = split.disabled = view !== "sessions" || !selected || sessions.length < 2;
    split.setAttribute("aria-pressed", String(workspace.sessionIds().length > 1));
    const current = sessions.find((session) => session.id === selected);
    el("session-title").textContent = current?.title ?? "Session unavailable";
    el("session-meta").textContent = current
      ? sessionMeta(current)
      : "This session may have closed on your computer.";
    el("session-path").textContent = current?.path ?? "";
    el("workspace-folder").textContent =
      current?.path?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace";
    el("workspace-folder").title = current?.path ?? root;
    el("workspace-session").textContent =
      view === "new" ? "New session" : view === "quota" ? "Quota" : (current?.title ?? "Sessions");
    el("session-state").hidden = !current;
    if (current) {
      const state = sessionState(current);
      el("session-state").textContent = state.label;
      el("session-state").dataset.state = state.state;
    }
    if (selected && !current) {
      viewed = null;
      renderDraft();
    }
  }
  function fitViewport() {
    const viewport = window.visualViewport;
    const app = el("app-view");
    app.style.setProperty("--remote-height", `${Math.round(viewport?.height ?? innerHeight)}px`);
    app.style.setProperty("--remote-top", `${Math.round(viewport?.offsetTop ?? 0)}px`);
    if (el<HTMLInputElement>("follow").checked) terminal.scrollTop = terminal.scrollHeight;
  }
  async function readScreen() {
    if (workspace) {
      if (view === "sessions") workspace.open(sessions.find((row) => row.id === selected) ?? null);
      return;
    }
    const id = selected;
    if (!id || view !== "sessions") return;
    const started = epoch;
    try {
      const screen = await api<Screen>(`/v1/sessions/${encodeURIComponent(id)}/screen`);
      if (started !== epoch || selected !== id || view !== "sessions") return;
      viewed = screen;
      const signature = JSON.stringify([
        screen.text,
        screen.rows,
        screen.foreground,
        screen.background,
      ]);
      if (screenSignature !== signature) {
        screenSignature = signature;
        const position = terminal.scrollTop;
        terminal.style.color = screen.foreground ?? "";
        terminal.style.backgroundColor = screen.background ?? "";
        if (screen.rows) {
          const content = document.createDocumentFragment();
          for (let index = 0; index < screen.rows.length; index++) {
            if (index) content.append(document.createTextNode("\n"));
            for (const run of screen.rows[index]) {
              const span = make("span", "terminal-run", run.text);
              span.style.color = run.foreground;
              span.style.backgroundColor = run.background;
              for (const [flag, name] of [
                [1, "bold"],
                [2, "italic"],
                [4, "underline"],
                [8, "strike"],
                [16, "dim"],
              ] as const)
                if (run.flags & flag) span.classList.add(`terminal-${name}`);
              content.append(span);
            }
          }
          terminal.replaceChildren(content);
        } else terminal.textContent = screen.text;
        terminal.scrollTop = el<HTMLInputElement>("follow").checked
          ? terminal.scrollHeight
          : position;
      }
      el("screen-status").textContent = screen.alive ? "Live screen" : "Session ended";
      el("screen-status").dataset.state = screen.alive ? "live" : "ended";
      renderDraft();
    } catch (cause) {
      if (started === epoch && selected === id) {
        viewed = null;
        el("screen-status").textContent = message(cause);
        el("screen-status").dataset.state = "error";
        renderDraft();
      }
    }
  }
  function quotaWindow(label: string, value: number | null, reset: number | null) {
    const row = make("div", "quota-window");
    row.dataset.level = value === 0 ? "empty" : value !== null && value <= 10 ? "low" : "normal";
    row.append(make("span", "", label));
    if (value === null) row.append(make("span", "muted", "Unknown"), make("span"));
    else if (value === 0 && reset !== null) {
      row.append(
        make("span", "muted", `Resets ${new Date(reset).toLocaleString()}`),
        make("span", "", "0%"),
      );
    } else {
      const bar = make("progress");
      bar.max = 100;
      bar.value = value;
      bar.setAttribute("aria-label", `${label} remaining`);
      row.append(
        bar,
        make("span", "", `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`),
      );
    }
    return row;
  }
  function renderQuota() {
    const list = el("quota-list");
    list.replaceChildren();
    el("quota-status").textContent =
      quota?.error ??
      (quota?.snapshot
        ? `Checked ${new Date(quota.snapshot.checkedAtMs).toLocaleTimeString()}${quota.stale ? " · cached" : ""}`
        : "Quota is unavailable. Check CLI Manager on your computer.");
    for (const provider of ["codex", "agy"] as const) {
      const accounts = quota?.snapshot?.accounts.filter((row) => row.agent === provider) ?? [];
      if (!accounts.length) continue;
      const group = make("section", "quota-group");
      group.append(make("h2", "", agentName(provider)));
      for (const row of accounts) {
        const item = make("div", "quota-account");
        const heading = make("div", "account-heading");
        const active = make("span", "", row.active ? "Active account" : "");
        active.dataset.active = String(row.active);
        heading.append(make("strong", "", row.name), active);
        item.append(
          heading,
          quotaWindow("5h", row.fiveHour, row.fiveHourResetAtMs),
          quotaWindow("1w", row.weekly, row.weeklyResetAtMs),
        );
        const stale = row.observedAtMs === null || Date.now() - row.observedAtMs > 300_000;
        const notes = [
          row.state !== "ready" ? "Quota unavailable" : "",
          row.limited ? "Limited" : "",
          stale || quota?.stale ? "Cached reading" : "",
        ].filter(Boolean);
        if (notes.length) item.append(make("p", "quota-note", notes.join(" · ")));
        group.append(item);
      }
      list.append(group);
    }
    if (quota?.snapshot && !quota.snapshot.accounts.length)
      list.append(make("p", "empty", "No accounts reported by CLI Manager."));
  }
  function renderRailQuota() {
    const list = el("rail-quota-list");
    list.replaceChildren();
    const accounts = quota?.snapshot?.accounts.filter((row) => row.agent === "codex") ?? [];
    el("rail-quota-status").textContent = quota?.error
      ? quota.snapshot
        ? "Offline · cached reading"
        : "Quota unavailable"
      : quota?.stale
        ? "Cached reading"
        : accounts.length
          ? ""
          : "No Codex accounts available.";
    for (const account of accounts) {
      const row = make("div", "rail-quota-account");
      const name = make("span", "rail-quota-name", account.name);
      const cached =
        quota?.stale ||
        account.observedAtMs === null ||
        Date.now() - account.observedAtMs > 300_000;
      name.dataset.note = account.state !== "ready" ? "Unavailable" : cached ? "Cached" : "";
      name.title = [account.name, name.dataset.note].filter(Boolean).join(" · ");
      const windows = make("div", "rail-quota-windows");
      for (const [label, value, reset] of [
        ["5h", account.fiveHour, account.fiveHourResetAtMs],
        ["1w", account.weekly, account.weeklyResetAtMs],
      ] as const) {
        const window = quotaWindow(label, value, reset);
        if (value === 0 && reset !== null) {
          const resetLabel = window.children[1] as HTMLElement;
          const minutes = Math.max(0, Math.ceil((reset - Date.now()) / 60000));
          resetLabel.textContent =
            label === "5h"
              ? `Resets in ${minutes >= 60 ? `${Math.floor(minutes / 60)}h ` : ""}${minutes % 60}m`
              : new Date(reset).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });
          resetLabel.title = new Date(reset).toLocaleString();
        }
        windows.append(window);
      }
      row.append(name, windows);
      list.append(row);
    }
  }
  function renderAccounts() {
    const previous = account.value;
    account.replaceChildren(new Option("Default account", ""));
    for (const row of quota?.snapshot?.accounts ?? []) {
      if (row.agent === agent.value) account.add(new Option(row.name, row.id));
    }
    if (Array.from(account.options).some((option) => option.value === previous))
      account.value = previous;
    account.disabled = !agent.value || creating || !!pendingCreate;
  }
  async function refreshQuota(force = false) {
    if (quotaBusy || (!force && Date.now() - quotaAt < 30_000)) return;
    const started = epoch;
    quotaBusy = true;
    el<HTMLButtonElement>("refresh-quota").disabled = true;
    try {
      const next = await api<Quota>("/v1/quota");
      if (started !== epoch) return;
      quota = next;
      quotaAt = Date.now();
      renderQuota();
      renderRailQuota();
      if (!pendingCreate) renderAccounts();
    } catch (cause) {
      if (started === epoch)
        el("quota-status").textContent =
          `${message(cause)}${quota ? " Showing the last reading." : ""}`;
    } finally {
      if (started === epoch) {
        quotaBusy = false;
        el<HTMLButtonElement>("refresh-quota").disabled = false;
      }
    }
  }
  async function poll() {
    if (!token || document.hidden || pollingEpoch === epoch) return;
    const started = epoch;
    pollingEpoch = started;
    clearTimeout(timer);
    try {
      const next = await api<RemoteSession[]>("/v1/sessions");
      if (started !== epoch) return;
      sessions = next;
      if (restoreView) {
        restoreView = false;
        if (preferences.selected && sessions.some((row) => row.id === preferences.selected)) {
          const secondary = preferences.secondary;
          selectSession(preferences.selected);
          workspace.secondary(secondary ?? null);
          savePreferences();
        }
      } else if (selected && !sessions.some((row) => row.id === selected)) selectSession(null);
      el("session-list").setAttribute("aria-busy", "false");
      const signature = JSON.stringify(sessions);
      if (signature !== sessionSignature) {
        sessionSignature = signature;
        renderSessions();
      }
      network(true);
      notice();
      await readScreen();
      await refreshQuota();
    } catch (cause) {
      if (started === epoch) {
        viewed = null;
        network(false);
        notice(message(cause));
      }
    } finally {
      if (pollingEpoch === started) pollingEpoch = null;
      if (started === epoch && token && !document.hidden)
        timer = setTimeout(() => void poll(), online ? 1500 : 5000);
    }
  }
  function renderFolders() {
    el("folder-path").textContent = folders?.path ?? "Loading folders…";
    const locked = creating || !!pendingCreate || folderLoading;
    el<HTMLButtonElement>("folder-up").disabled = locked || !folders?.parent;
    agent.disabled = locked;
    account.disabled = locked || !agent.value;
    const list = el("folder-list");
    list.replaceChildren();
    for (const entry of folders?.entries ?? []) {
      const button = make("button", "folder-row");
      button.append(icon("Folder"), make("span", "", entry.name), icon("CaretRight", 16));
      button.type = "button";
      button.disabled = locked;
      button.addEventListener("click", () => void loadFolders(entry.path));
      list.append(button);
    }
    el("folder-note").textContent = folders?.truncated
      ? "Showing the first 500 folders. Open a folder to continue."
      : folders && !folders.entries.length
        ? "No subfolders. You can start a session here."
        : "";
    const create = el<HTMLButtonElement>("create");
    create.disabled = creating || folderLoading || !folders;
    create.textContent = creating
      ? "Starting…"
      : pendingCreate
        ? "Retry same request"
        : "Start session here";
    el("edit-create").hidden = !pendingCreate || creating;
  }
  async function loadFolders(path: string) {
    if (creating || pendingCreate) return;
    const serial = ++folderRequest;
    const started = epoch;
    folders = null;
    folderLoading = true;
    renderFolders();
    try {
      const next = await api<Folders>(`/v1/folders?path=${encodeURIComponent(path)}`);
      if (started !== epoch || serial !== folderRequest) return;
      folders = next;
    } catch (cause) {
      if (started === epoch && serial === folderRequest)
        el("create-note").textContent = message(cause);
    } finally {
      if (started === epoch && serial === folderRequest) {
        folderLoading = false;
        renderFolders();
      }
    }
  }
  async function connect(value: string) {
    const button = el<HTMLButtonElement>("connect");
    button.disabled = true;
    button.textContent = "Connecting…";
    el("pair-error").hidden = true;
    cancelRequests();
    const started = epoch;
    try {
      let key = value.trim();
      if (!/^[a-f0-9]{64}$/.test(key)) {
        const url = new URL(key);
        const server =
          url.protocol === "deckremote:" ? new URL(url.searchParams.get("server") ?? "") : url;
        if (server.origin !== location.origin)
          throw new Error("Open the copied web link in Safari to connect to that computer.");
        key =
          url.protocol === "deckremote:"
            ? (url.searchParams.get("token") ?? "")
            : (new URLSearchParams(url.hash.slice(1)).get("token") ?? "");
      }
      if (!/^[a-f0-9]{64}$/.test(key))
        throw new Error("Paste a connection copied from Deck Settings → Remote.");
      token = key;
      const info = await api<{
        name: string;
        root: string;
        protocolVersion: number;
        workspaceMode?: string;
      }>("/v1/info");
      if (started !== epoch) return;
      if (info.protocolVersion !== 1)
        throw new Error(
          "This computer uses a different Deck Remote version. Update Deck and reload this page.",
        );
      root = info.root;
      independent = info.workspaceMode === "independent";
      restoreView = true;
      preferences = {};
      collapsedFolders.clear();
      rememberedFolders.clear();
      if (independent) {
        try {
          const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? "{}");
          if (saved && typeof saved === "object" && !Array.isArray(saved)) {
            preferences = {
              selected: typeof saved.selected === "string" ? saved.selected : null,
              secondary: typeof saved.secondary === "string" ? saved.secondary : null,
            };
            for (const key of ["collapsed", "folders"] as const) {
              const values = Array.isArray(saved[key])
                ? saved[key]
                    .filter((item: unknown) => typeof item === "string" && item.length < 4096)
                    .slice(0, 128)
                : [];
              for (const item of values)
                (key === "collapsed" ? collapsedFolders : rememberedFolders).add(item);
            }
          }
        } catch {
          /* Ignore invalid browser-only layout preferences. */
        }
      }
      el("computer").textContent = info.name;
      connection.value = "";
      savedToken(el<HTMLInputElement>("remember").checked ? key : "");
      el("pair-view").hidden = true;
      el("app-view").hidden = false;
      fitViewport();
      network(true);
      renderSessions();
      showView("sessions");
      void poll();
    } catch (cause) {
      if (started === epoch) {
        token = "";
        el("pair-error").textContent = message(cause);
        el("pair-error").hidden = false;
      }
    } finally {
      if (started === epoch) {
        button.disabled = false;
        button.textContent = "Connect to computer";
      }
    }
  }
  async function sendInput() {
    const id = selected;
    if (!id || send.disabled) return;
    const current = draft(id);
    if (!current.pending) {
      if (!viewed || viewed.session.id !== id || !viewed.alive) return;
      current.pending = mutation({ text: current.text, generation: viewed.session.generation });
    }
    const started = epoch;
    sending.add(id);
    current.review = false;
    current.note = "Sending to your computer…";
    renderDraft();
    try {
      const result = await api<{ status: string }>(
        `/v1/sessions/${encodeURIComponent(id)}/input`,
        current.pending,
      );
      if (started !== epoch) return;
      current.pending = undefined;
      current.text = "";
      current.review = result.status === "inserted";
      current.note =
        result.status === "inserted"
          ? "Text inserted. Review the screen, then tap Enter."
          : "Sent to your computer.";
      void readScreen();
    } catch (cause) {
      if (started === epoch)
        current.note = `${message(cause)} Review output before editing or retrying. Nothing resends automatically.`;
    } finally {
      if (started === epoch) {
        sending.delete(id);
        renderDraft();
      }
    }
  }
  async function createSession() {
    if (creating || !folders) return;
    pendingCreate ??= mutation({
      path: folders.path,
      agentId: agent.value || null,
      accountId: account.value || null,
    });
    const started = epoch;
    creating = true;
    el("create-note").textContent = "Starting on your computer…";
    renderFolders();
    try {
      const session = await api<RemoteSession>("/v1/sessions", pendingCreate);
      if (started !== epoch) return;
      pendingCreate = null;
      el("create-note").textContent = "";
      if (!sessions.some((row) => row.id === session.id)) sessions.push(session);
      if (session.path) rememberedFolders.add(session.path);
      selectSession(session.id);
    } catch (cause) {
      if (started === epoch)
        el("create-note").textContent =
          `${message(cause)} Retry the same request to avoid opening a duplicate session.`;
    } finally {
      if (started === epoch) {
        creating = false;
        renderFolders();
      }
    }
  }

  async function closeSession(session: RemoteSession) {
    if (closing.has(session.id) || !online) return;
    if (
      !pendingCloses.has(session.id) &&
      !window.confirm(`Close ${session.title}? Its running processes will stop.`)
    )
      return;
    const request = pendingCloses.get(session.id) ?? mutation({ generation: session.generation });
    pendingCloses.set(session.id, request);
    closing.add(session.id);
    renderSessions();
    const started = epoch;
    try {
      await api(`/v1/sessions/${session.id}/close`, request);
      if (started !== epoch) return;
      pendingCloses.delete(session.id);
      sessions = sessions.filter((row) => row.id !== session.id);
      if (selected === session.id) selectSession(sessions[0]?.id ?? null);
      renderSessions();
      savePreferences();
    } catch (cause) {
      if (started === epoch) notice(message(cause));
    } finally {
      closing.delete(session.id);
      if (started === epoch) renderSessions();
    }
  }

  let pendingFolder: Mutation | null = null;
  el<HTMLFormElement>("folder-create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!folders || creating || pendingCreate || folderLoading) return;
    const name = el<HTMLInputElement>("folder-name");
    const button = el<HTMLButtonElement>("create-folder");
    pendingFolder ??= mutation({ path: folders.path, name: name.value });
    const started = epoch;
    button.disabled = true;
    folderLoading = true;
    renderFolders();
    void api<Folders>("/v1/folders", pendingFolder)
      .then((next) => {
        if (started !== epoch) return;
        folders = next;
        rememberedFolders.add(next.path);
        savePreferences();
        renderSessions();
        name.value = "";
        pendingFolder = null;
        el("create-note").textContent = "Folder created. Choose an agent or start a shell here.";
      })
      .catch((error) => {
        if (started === epoch) el("create-note").textContent = message(error);
      })
      .finally(() => {
        button.disabled = false;
        folderLoading = false;
        renderFolders();
      });
  });
  el("folder-name").addEventListener("input", () => {
    pendingFolder = null;
  });

  el<HTMLFormElement>("pair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void connect(connection.value);
  });
  el("disconnect").addEventListener("click", () => {
    workspace.open(null);
    cancelRequests();
    token = "";
    savedToken("");
    drafts.clear();
    sending.clear();
    selected = null;
    viewed = null;
    sessions = [];
    sessionSignature = "";
    pendingCreate = null;
    creating = false;
    folders = null;
    folderLoading = false;
    quota = null;
    quotaAt = 0;
    quotaBusy = false;
    selectSession(null);
    el("app-view").hidden = true;
    el("pair-view").hidden = false;
    el("pair-error").hidden = true;
    el<HTMLButtonElement>("connect").disabled = false;
  });
  el("nav-sessions").addEventListener("click", () => {
    showView("sessions");
    void poll();
  });
  el("nav-quota").addEventListener("click", () => {
    showView("quota");
    void refreshQuota();
  });
  el("refresh-quota").addEventListener("click", () => void refreshQuota(true));
  el("back-sessions").addEventListener("click", () => selectSession(null));
  el("search").addEventListener("input", renderSessions);
  el("follow").addEventListener("change", () => {
    if (el<HTMLInputElement>("follow").checked) terminal.scrollTop = terminal.scrollHeight;
  });
  composer.addEventListener("input", () => {
    if (selected) {
      draft(selected).text = composer.value;
      renderDraft();
    }
  });
  el<HTMLFormElement>("input-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void sendInput();
  });
  el("edit-input").addEventListener("click", () => {
    if (!selected) return;
    const current = draft(selected);
    current.pending = undefined;
    current.note = "Review the screen before sending another instruction.";
    renderDraft();
  });
  function openNewSession() {
    showView("new");
    if (!pendingCreate) {
      el("create-note").textContent = "";
      void loadFolders(root);
    }
    void refreshQuota();
  }
  el("split-terminal").addEventListener("click", () => {
    workspace.split();
    el("split-terminal").setAttribute("aria-pressed", String(workspace.sessionIds().length > 1));
    savePreferences();
  });
  el("new-session").addEventListener("click", openNewSession);
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
  });
  window.addEventListener("resize", fitViewport);
  window.visualViewport?.addEventListener("resize", fitViewport);
  window.visualViewport?.addEventListener("scroll", fitViewport);
  el("cancel-new").addEventListener("click", () => showView("sessions"));
  el("folder-up").addEventListener("click", () => {
    if (folders?.parent) void loadFolders(folders.parent);
  });
  agent.addEventListener("change", renderAccounts);
  el<HTMLFormElement>("create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void createSession();
  });
  el("edit-create").addEventListener("click", () => {
    pendingCreate = null;
    el("create-note").textContent = "Check your running sessions before starting another one.";
    renderFolders();
  });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    workspace.suspend(document.hidden || view !== "sessions");
    if (!document.hidden) void poll();
  });
  window.addEventListener("online", () => void poll());
  window.addEventListener("offline", () => network(false));
  window.addEventListener("pagehide", () => {
    workspace.suspend(true);
    cancelRequests();
    for (const id of sending)
      draft(id).note =
        "The page was suspended. Review output, then retry the same request if needed.";
    sending.clear();
    creating = false;
    quotaBusy = false;
    el<HTMLButtonElement>("refresh-quota").disabled = false;
    folderLoading = false;
    renderDraft();
    renderFolders();
  });
  window.addEventListener("pageshow", () => {
    workspace.suspend(view !== "sessions");
    fitViewport();
    if (token && view === "new" && !folders && !pendingCreate) void loadFolders(root);
    void poll();
  });

  const incoming = new URLSearchParams(location.hash.slice(1)).get("token");
  // A fragment never reaches the HTTP server; remove it before any further navigation.
  if (location.hash) history.replaceState(null, "", location.pathname);
  if (incoming) connection.value = incoming;
  else {
    const remembered = savedToken();
    if (/^[a-f0-9]{64}$/.test(remembered)) void connect(remembered);
  }
}

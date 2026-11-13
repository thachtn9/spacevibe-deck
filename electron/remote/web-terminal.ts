/// <reference lib="dom" />
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { RemoteSession, RemoteTerminalFrame } from "../../src/lib/deck-remote";

export type TerminalWorkspace = ReturnType<typeof createWebTerminal>;

/** Serialized separately; runtime dependencies are the packaged xterm UMD distributions. */
export function createWebTerminal(deps: {
  root: HTMLElement;
  token: () => string;
  sessions: () => RemoteSession[];
  onSecondaryChange?: () => void;
  mutate: (id: string, body: unknown) => Promise<unknown>;
}) {
  const runtime = window as unknown as {
    Terminal: new (options: object) => Terminal;
    FitAddon: { FitAddon: new () => FitAddon };
    UnicodeGraphemesAddon: {
      UnicodeGraphemesAddon: new () => import("@xterm/addon-unicode-graphemes").UnicodeGraphemesAddon;
    };
    WebglAddon?: { WebglAddon: new () => import("@xterm/addon-webgl").WebglAddon };
  };
  type View = {
    element: HTMLElement;
    session: RemoteSession;
    close: () => void;
    refresh: () => void;
  };
  let views: View[] = [];
  let suspended = false;
  const random = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const make = (tag: string, className = "", text = "") => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  function mount(session: RemoteSession): View {
    let client = `${Date.now()}-${random()}`;
    let sequence = 0;
    let actions: Promise<unknown> = Promise.resolve();
    const wrapper = make("section", "web-terminal-pane");
    wrapper.setAttribute("aria-label", session.title);
    const status = make("p", "web-terminal-status", "Connecting…");
    status.setAttribute("role", "status");
    const body = make("div", "web-terminal-body");
    status.dataset.title = session.title;
    wrapper.append(body, status);
    deps.root.append(wrapper);
    const term = new runtime.Terminal({
      cursorBlink: true,
      disableStdin: true,
      scrollback: 5000,
      fontSize: 14,
      fontFamily:
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Noto Sans Mono", monospace',
      // Match desktop leading so stacked Vietnamese accents fit within each row.
      lineHeight: 1.25,
      allowProposedApi: true,
      theme: {
        background: "#0a0a0a",
        foreground: "#cbcbcb",
        cursor: "#cbcbcb",
        selectionBackground: "#334a78",
      },
    });
    const fit = new runtime.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new runtime.UnicodeGraphemesAddon.UnicodeGraphemesAddon());
    term.unicode.activeVersion = "15-graphemes";
    term.open(body);
    let renderer: import("@xterm/addon-webgl").WebglAddon | undefined;
    if (runtime.WebglAddon) {
      try {
        const addon = new runtime.WebglAddon.WebglAddon();
        renderer = addon;
        addon.onContextLoss(() => {
          if (renderer !== addon) return;
          renderer = undefined;
          addon.dispose();
          term.refresh(0, term.rows - 1);
        });
        // Use the desktop glyph renderer for complete combining-mark clusters.
        term.loadAddon(addon);
      } catch {
        renderer?.dispose();
        renderer = undefined;
      }
    }
    let closed = false;
    let controlled = false;
    let received = false;
    let alive = true;
    let stream: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let inputTimer: ReturnType<typeof setTimeout> | undefined;
    let input = "";
    let writing = false;
    let claiming = false;
    let focusOnControl = false;
    let claimOnOpen = true;
    let controllerId: string | null = null;
    let keyInput: string | null = null;
    let userEvent = false;
    let inputEvent: Event | undefined;
    const report = (error: unknown) => {
      status.dataset.state = "error";
      status.textContent = error instanceof Error ? error.message : String(error);
    };
    const setControl = (value: boolean) => {
      controlled = value;
      term.options.disableStdin = !value;
      wrapper.dataset.controlled = String(value);
    };
    const action = (kind: string, extra: object = {}) => {
      const request = {
        action: kind,
        client,
        sequence: ++sequence,
        generation: session.generation,
        ...extra,
      };
      const result = actions.then(() => deps.mutate(session.id, request));
      actions = result.catch(() => {});
      return result;
    };
    async function claim() {
      if (closed || claiming || !received || !alive) return;
      claiming = true;
      try {
        const dimensions = fit.proposeDimensions();
        if (!dimensions) throw new Error("The terminal is not visible yet.");
        if (!controlled) focusOnControl = true;
        await action("claim", {
          cols: Math.max(24, Math.min(500, dimensions.cols)),
          rows: Math.max(2, Math.min(200, dimensions.rows)),
        });
        if (closed) {
          await action("release").catch(() => {});
          return;
        }
      } catch (error) {
        focusOnControl = false;
        claimOnOpen = true;
        report(error);
      } finally {
        claiming = false;
      }
    }
    async function flushInput() {
      if (writing || closed || !controlled || !input) return;
      const data = input;
      input = "";
      writing = true;
      try {
        await action("write", { data });
      } catch (error) {
        input = "";
        setControl(false);
        received = false;
        stream?.abort();
        report(error);
        status.textContent += " Input was not replayed. Reconnect to review the terminal.";
        retry = setTimeout(() => void connect(), 3000);
      } finally {
        writing = false;
        if (input) void flushInput();
      }
    }
    // The owning parser answers protocol queries; forward only user-generated input.
    term.onKey(({ key }) => {
      keyInput = key;
    });
    const markInput = (event?: Event) => {
      if (event) inputEvent = event;
      if (event && "data" in event && typeof event.data === "string") keyInput = event.data;
      userEvent = true;
      queueMicrotask(() => {
        userEvent = false;
      });
    };
    for (const event of [
      "keydown",
      "paste",
      "input",
      "compositionend",
      "pointerdown",
      "pointermove",
      "pointerup",
      "mousedown",
      "mousemove",
      "mouseup",
      "wheel",
    ])
      body.addEventListener(event, markInput, true);
    term.onData((data) => {
      // Browsers may drain microtasks between capture and xterm's event listener.
      // eventPhase lasts for the entire dispatch, unlike the microtask flag.
      const dispatchingInput = inputEvent && inputEvent.eventPhase !== Event.NONE;
      if (!controlled || closed || (!userEvent && !dispatchingInput && keyInput !== data)) return;
      if (keyInput === data) keyInput = null;
      if (new TextEncoder().encode(input + data).length > 32768) {
        report("Input exceeds 32 KB. Paste a smaller block.");
        return;
      }
      input += data;
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => void flushInput(), 8);
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.shiftKey && event.code === "KeyC") {
        if (event.type === "keydown" && term.hasSelection())
          void navigator.clipboard?.writeText(term.getSelection());
        return false;
      }
      if (event.ctrlKey && event.shiftKey && event.code === "KeyV") {
        if (event.type === "keydown" && controlled)
          void navigator.clipboard?.readText().then((text) => {
            markInput();
            term.paste(text);
          });
        return false;
      }
      return true;
    });
    async function apply(frame: RemoteTerminalFrame) {
      if (frame.reset) term.reset();
      if (frame.cols !== term.cols || frame.rows !== term.rows) term.resize(frame.cols, frame.rows);
      await new Promise<void>((resolve) => term.write(frame.data, resolve));
      if (closed) return;
      received = true;
      alive = frame.alive !== false;
      setControl(frame.controller === client);
      if (controlled && focusOnControl) {
        focusOnControl = false;
        term.focus();
      }
      controllerId = frame.controller;
      status.dataset.state = !alive ? "ended" : controlled ? "live" : "pending";
      status.textContent = !alive
        ? "Session ended"
        : controlled
          ? "Connected"
          : frame.controller
            ? "Active in another browser window"
            : "Click the terminal to continue";
      if (alive && !frame.controller && claimOnOpen && !claiming) {
        claimOnOpen = false;
        await claim();
      }
    }
    async function connect() {
      if (closed || suspended) return;
      stream?.abort();
      const controller = new AbortController();
      stream = controller;
      received = false;
      claimOnOpen = true;
      client = `${Date.now()}-${random()}`;
      sequence = 0;
      try {
        const query = new URLSearchParams({ client, generation: session.generation });
        const response = await fetch(`/v1/sessions/${session.id}/stream?${query}`, {
          headers: { Authorization: `Bearer ${deps.token()}` },
          signal: controller.signal,
          mode: "same-origin",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
        });
        if (!response.ok) throw new Error((await response.json()).error ?? "Terminal unavailable.");
        if (!response.body) throw new Error("This browser does not support terminal streaming.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        while (!closed && !controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) throw new Error("Terminal disconnected. Reconnecting…");
          pending += decoder.decode(value, { stream: true });
          if (pending.length > 4_194_304) throw new Error("Terminal frame is too large.");
          let end: number;
          while ((end = pending.indexOf("\n")) >= 0) {
            const frame = JSON.parse(pending.slice(0, end));
            pending = pending.slice(end + 1);
            if (frame.error) throw new Error(frame.error);
            await apply(frame);
          }
        }
      } catch (error) {
        if (!closed && !controller.signal.aborted) {
          setControl(false);
          input = "";
          received = false;
          report(error);
          retry = setTimeout(() => void connect(), 3000);
        }
      }
    }
    body.addEventListener("pointerdown", () => {
      if (!controlled && !controllerId) void claim();
    });

    // A normal buffer scrolls locally even when a CLI captures mouse reports.
    // Alternate-screen applications retain their own wheel protocol.
    let wheelRemainder = 0;
    const scrollPixels = (pixels: number) => {
      const height =
        body.querySelector(".xterm-screen")?.getBoundingClientRect().height ?? body.clientHeight;
      const cellHeight = Math.max(1, height / term.rows);
      if (wheelRemainder && Math.sign(wheelRemainder) !== Math.sign(pixels)) wheelRemainder = 0;
      wheelRemainder += pixels / cellHeight;
      const lines = Math.trunc(wheelRemainder);
      if (lines) {
        term.scrollLines(lines);
        wheelRemainder -= lines;
      }
    };
    body.addEventListener(
      "wheel",
      (event) => {
        if (
          term.buffer.active.type !== "normal" ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          !event.deltaY
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.deltaMode === 0) scrollPixels(event.deltaY);
        else term.scrollLines(event.deltaY * (event.deltaMode === 2 ? term.rows : 1));
      },
      { capture: true, passive: false },
    );
    let touchY: number | null = null;
    body.addEventListener(
      "touchstart",
      (event) => {
        touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
      },
      { capture: true, passive: true },
    );
    body.addEventListener(
      "touchmove",
      (event) => {
        if (touchY === null || event.touches.length !== 1) return;
        const touch = event.touches[0];
        const deltaY = touchY - touch.clientY;
        touchY = touch.clientY;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (term.buffer.active.type === "normal") scrollPixels(deltaY);
        else
          term.element?.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY,
              clientX: touch.clientX,
              clientY: touch.clientY,
            }),
          );
      },
      { capture: true, passive: false },
    );
    body.addEventListener(
      "touchend",
      () => {
        touchY = null;
      },
      { passive: true },
    );
    body.addEventListener(
      "touchcancel",
      () => {
        touchY = null;
      },
      { passive: true },
    );
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (controlled) void claim();
      }, 120);
    });
    observer.observe(body);
    const view: View = {
      element: wrapper,
      session,
      refresh() {
        const current = deps.sessions().find((row) => row.id === session.id);
        const title = current?.title ?? session.title;
        wrapper.setAttribute("aria-label", title);
        status.dataset.title = title;
      },
      close() {
        closed = true;
        stream?.abort();
        clearTimeout(retry);
        clearTimeout(resizeTimer);
        clearTimeout(inputTimer);
        if (controlled) void action("release").catch(() => {});
        observer.disconnect();
        renderer?.dispose();
        term.dispose();
        wrapper.remove();
      },
    };
    view.refresh();
    void connect();
    return view;
  }
  return {
    open(session: RemoteSession | null) {
      if (
        session &&
        views[0]?.session.id === session.id &&
        views[0]?.session.generation === session.generation
      )
        return;
      if (
        session &&
        !suspended &&
        views[1]?.session.id === session.id &&
        views[1].session.generation === session.generation
      ) {
        views.reverse();
        views.forEach((view) => deps.root.append(view.element));
        return;
      }
      const secondary = session && !suspended ? views[1] : undefined;
      views[0]?.close();
      if (!secondary) views.slice(1).forEach((view) => view.close());
      views = session && !suspended ? [mount(session), ...(secondary ? [secondary] : [])] : [];
      views.forEach((view) => deps.root.append(view.element));
    },
    split() {
      if (views.length > 1) {
        views.pop()!.close();
        return;
      }
      const next = deps.sessions().find((row) => row.id !== views[0]?.session.id);
      if (next) views.push(mount(next));
    },
    sessionIds() {
      return views.map((view) => view.session.id);
    },
    secondary(id: string | null) {
      if (!views[0] || views[1]?.session.id === id) return;
      if (views.length > 1) views.pop()!.close();
      const next = deps.sessions().find((row) => row.id === id && row.id !== views[0].session.id);
      if (next) views.push(mount(next));
    },
    refresh() {
      if (views[1] && !deps.sessions().some((row) => row.id === views[1].session.id)) {
        views.pop()!.close();
        deps.onSecondaryChange?.();
      }
      views.forEach((view) => view.refresh());
    },
    suspend(value: boolean) {
      suspended = value;
      if (value) {
        views.forEach((view) => view.close());
        views = [];
      }
    },
  };
}

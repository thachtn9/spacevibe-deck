chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(console.error);
const API = "http://127.0.0.1:43129";
const locks = new Set();

async function api(route, payload, reconnect = true) {
  const { token } = await chrome.storage.local.get("token");
  const response = await fetch(API + route, {
    method: payload === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Deck-Extension": chrome.runtime.id,
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(35000),
  });
  const value = await response.json();
  if (response.status === 401 && reconnect && route !== "/connect") {
    const connected = await api("/connect", {}, false);
    await chrome.storage.local.set({ token: connected.token });
    return api(route, payload, false);
  }
  if (!response.ok) {
    throw new Error(value.error || "Deck request failed.");
  }
  return value;
}

let preparedActive = null;
async function prepareActive() {
  const state = await api("/state");
  preparedActive = state.active || null;
  return state;
}

async function sendNotes(url) {
  const { notes = [], pendingBatch } = await chrome.storage.local.get(["notes", "pendingBatch"]);
  let batch = pendingBatch;
  if (!batch) {
    const target = preparedActive || (await prepareActive()).active;
    if (!target)
      throw new Error(
        "In Deck, right-click an agent session and select Set active for Browser Review.",
      );
    const annotations = notes.filter((n) => n.capture?.url === url);
    if (!annotations.length) throw new Error("Add a comment on this page first.");
    const t = target;
    batch = {
      id: crypto.randomUUID(),
      root: t.root,
      clientId: t.clientId,
      paneId: t.paneId,
      sessionId: t.sessionId,
      annotations,
    };
    await chrome.storage.local.set({ pendingBatch: batch });
  }
  const result = await api("/batch", batch);
  if (result.status === "sent") {
    const sent = new Set(batch.annotations.map((n) => n.id));
    const latest = await chrome.storage.local.get("notes");
    await chrome.storage.local.set({
      notes: (latest.notes || []).filter((n) => !sent.has(n.id)),
      pendingBatch: null,
    });
  } else if (result.status === "cancelled") {
    await chrome.storage.local.set({ pendingBatch: null });
    throw new Error(result.message);
  }
  return result;
}

async function active() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//.test(tab.url || ""))
    throw new Error("Open an HTTP or HTTPS web app and click the extension icon on that tab.");
  return tab;
}

async function handle(message, sender) {
  const ownPage = sender.url?.startsWith(chrome.runtime.getURL(""));
  if (!ownPage && sender.tab) {
    if (["status", "send", "dismiss"].includes(message.type)) {
      if (sender.frameId !== 0) throw new Error("Top frame required.");
      if (message.type === "status") {
        const state = await prepareActive();
        const { pendingBatch } = await chrome.storage.local.get("pendingBatch");
        return { active: state.active?.label || "", ready: state.ready, pending: !!pendingBatch };
      }
      const tab = await chrome.tabs.get(sender.tab.id);
      if (!tab.active || tab.url !== sender.url) throw new Error("Keep the review page active.");
      if (message.type === "send") return sendNotes(tab.url);
      const { pendingBatch } = await chrome.storage.local.get("pendingBatch");
      if (pendingBatch) await api("/cancel", { id: pendingBatch.id });
      await chrome.storage.local.set({ pendingBatch: null });
      return {};
    }
    if (message.type === "get_notes") {
      const { notes = [] } = await chrome.storage.local.get("notes");
      return { notes: notes.filter((n) => n.capture?.url === sender.url) };
    }
    if (message.type === "edit" || message.type === "remove") {
      if (sender.frameId !== 0) throw new Error("Top frame required.");
      const { notes = [], pendingBatch } = await chrome.storage.local.get([
        "notes",
        "pendingBatch",
      ]);
      if (pendingBatch) throw new Error("Resolve the pending delivery before editing comments.");
      const note = notes.find((n) => n.id === message.id && n.capture?.url === sender.url);
      if (!note) throw new Error("Comment unavailable on this page.");
      if (message.type === "remove") {
        await chrome.storage.local.set({ notes: notes.filter((n) => n !== note) });
      } else {
        note.comment = String(message.comment || "").slice(0, 8000);
        await chrome.storage.local.set({ notes });
      }
      return {};
    }
    if (message.type !== "capture" || sender.frameId !== 0 || locks.has(sender.tab.id)) return;
    locks.add(sender.tab.id);
    try {
      const tab = await chrome.tabs.get(sender.tab.id);
      if (!tab.active || !/^https?:\/\//.test(tab.url || ""))
        throw new Error("Keep the selected tab active while capturing.");
      await prepareActive();
      const capture = JSON.parse(message.raw);
      if (capture.url !== tab.url) throw new Error("The page changed. Select again.");
      const geometry = async () =>
        (
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => JSON.stringify([location.href, innerWidth, innerHeight, scrollX, scrollY]),
          })
        )[0].result;
      const expected = JSON.stringify([
        capture.url,
        capture.viewport.width,
        capture.viewport.height,
        capture.viewport.scrollX,
        capture.viewport.scrollY,
      ]);
      if ((await geometry()) !== expected) throw new Error("The page moved. Select again.");
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      if ((await geometry()) !== expected || !(await chrome.tabs.get(tab.id)).active)
        throw new Error("The page changed during capture. Select again.");
      const { notes = [] } = await chrome.storage.local.get("notes");
      if (notes.length >= 20)
        throw new Error("Send or remove your 20 draft comments before adding more.");
      const noteComment = typeof message.comment === "string" ? message.comment.slice(0, 8000) : "";
      const noteSteps = typeof message.steps === "string" ? message.steps.slice(0, 4000) : "";
      const newNote = {
        id: crypto.randomUUID(),
        capture,
        image,
        comment: noteComment,
        steps: noteSteps,
      };
      notes.push(newNote);
      await chrome.storage.local.set({ notes, selected: newNote.id, notice: "" });
      return { success: true, note: newNote, count: notes.length };
    } catch (e) {
      await chrome.storage.local.set({ notice: e.message });
      throw e;
    } finally {
      locks.delete(sender.tab.id);
    }
  }
  // Only packaged extension pages can pair or communicate with Deck.
  if (!ownPage) throw new Error("Extension page required.");
  if (message.type === "edit" || message.type === "remove") {
    const { notes = [], pendingBatch } = await chrome.storage.local.get(["notes", "pendingBatch"]);
    if (pendingBatch) throw new Error("Resolve the pending delivery before editing comments.");
    if (message.type === "remove")
      await chrome.storage.local.set({ notes: notes.filter((n) => n.id !== message.id) });
    else {
      const note = notes.find((n) => n.id === message.id);
      if (note) {
        note.comment = String(message.comment).slice(0, 8000);
        note.steps = String(message.steps).slice(0, 4000);
      }
      await chrome.storage.local.set({ notes });
    }
    return {};
  }
  if (message.type === "pair") {
    const { token } = await api("/pair", { code: message.code });
    await chrome.storage.local.set({ token });
    return {};
  }
  if (message.type === "state") return api("/state");
  if (message.type === "batch") return api("/batch", message.batch);
  if (message.type === "cancel") return api("/cancel", { id: message.id });
  if (message.type === "mode") {
    const tab = await active();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["bridge.js"] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["capture.js"],
      world: "MAIN",
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: (mode) => window.__deckReview.setMode(mode),
      args: [message.mode],
    });
    return {};
  }
  throw new Error("Unknown extension action.");
}

let operations = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const task = operations.then(() => handle(message, sender));
  operations = task.catch(() => {});
  task.then(
    (value) => reply({ value }),
    (error) => reply({ error: error.message }),
  );
  return true;
});

async function toggleReview() {
  const tab = await active();
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["bridge.js"] });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["capture.js"],
    world: "MAIN",
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: () => window.__deckReview?.toggleToolbar?.(),
  });
}
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-review")
    void toggleReview().catch((error) => console.warn("Deck Review:", error));
});

chrome.action.onClicked.addListener(() => {
  void toggleReview().catch((error) => console.warn("Deck Review:", error));
});

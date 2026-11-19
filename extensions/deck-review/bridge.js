(() => {
  if (globalThis.__deckReviewBridge) return;
  globalThis.__deckReviewBridge = true;

  let _gesture = 0;
  for (const type of ["pointerup", "pointerdown", "keydown", "click"]) {
    window.addEventListener(
      type,
      (e) => {
        if (
          e.isTrusted &&
          e.target instanceof Element &&
          e.target.matches('[data-deck-review="overlay"]')
        )
          _gesture = Date.now();
      },
      true,
    );
  }

  async function request(message) {
    const reply = await chrome.runtime.sendMessage(message);
    if (reply?.error) throw new Error(reply.error);
    return reply?.value;
  }

  async function syncNotes() {
    const reply = await request({ type: "get_notes" });
    if (Array.isArray(reply?.notes)) {
      window.dispatchEvent(
        new CustomEvent("deck:web-review-sync-notes", {
          detail: JSON.stringify(reply.notes),
        }),
      );
    }
  }
  window.addEventListener("deck:web-review-ready", () => syncNotes().catch(() => {}));

  function delivery(value) {
    window.dispatchEvent(
      new CustomEvent("deck:web-review-delivery", { detail: JSON.stringify(value) }),
    );
  }
  async function status() {
    try {
      delivery(await request({ type: "status" }));
    } catch (error) {
      delivery({ error: error.message });
    }
  }
  let statusTimer;
  window.addEventListener("deck:web-review-ready", (e) => {
    clearInterval(statusTimer);
    if (e.detail === "open") statusTimer = setInterval(() => void status(), 5000);
    if (e.detail !== "closed") void status();
  });
  for (const type of ["send", "dismiss"]) {
    window.addEventListener("deck:web-review-" + type, () => {
      if (Date.now() - _gesture > 1500) return;
      delivery({ sending: true });
      request({ type })
        .then(async (result) => {
          await syncNotes();
          if (type === "dismiss") await status();
          else delivery({ ...result, pending: result.status !== "sent" });
        })
        .catch((error) => delivery({ error: error.message, pending: true }));
    });
  }

  // Handle capture event from in-page script
  window.addEventListener("deck:web-review-capture", (e) => {
    let raw = "";
    let comment = "";
    let steps = "";
    if (typeof e.detail === "string") {
      raw = e.detail;
      try {
        comment = JSON.parse(raw).comment || "";
      } catch {
        return;
      }
    } else if (e.detail && typeof e.detail === "object") {
      raw = e.detail.raw || "";
      comment = e.detail.comment || "";
      steps = e.detail.steps || "";
    }
    if (!raw || raw.length > 24000) return;
    request({ type: "capture", raw, comment, steps })
      .then(async (res) => {
        if (res?.success) await syncNotes();
        if (res?.error) delivery({ error: res.error });
        window.dispatchEvent(
          new CustomEvent("deck:web-review-capture-result", {
            detail: JSON.stringify(res || {}),
          }),
        );
      })
      .catch((err) => {
        window.dispatchEvent(
          new CustomEvent("deck:web-review-capture-result", {
            detail: JSON.stringify({ error: err.message }),
          }),
        );
      });
  });

  window.addEventListener("deck:web-review-edit-note", (e) => {
    try {
      const { id, comment } = JSON.parse(e.detail);
      request({ type: "edit", id, comment })
        .then(syncNotes)
        .catch(() => {});
    } catch {}
  });

  // Handle note removal from in-page pin
  window.addEventListener("deck:web-review-remove-note", (e) => {
    const id = e.detail && typeof e.detail === "object" ? e.detail.id : e.detail;
    if (id) {
      request({ type: "remove", id })
        .then(syncNotes)
        .catch(() => {});
    }
  });

  // Sync pins on storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.notes) {
      window.dispatchEvent(
        new CustomEvent("deck:web-review-sync-notes", {
          detail: JSON.stringify(changes.notes.newValue || []),
        }),
      );
    }
  });

  syncNotes().catch(() => {});

  // In-page Alt+X listener fallback
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.altKey && (e.key === "x" || e.key === "X")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.dispatchEvent(new CustomEvent("deck:web-review-toggle-toolbar"));
      }
    },
    true,
  );
})();

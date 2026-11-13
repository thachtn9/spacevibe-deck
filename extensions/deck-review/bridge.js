(() => {
  if (globalThis.__deckReviewBridge) return;
  globalThis.__deckReviewBridge = true;

  let gesture = Date.now();
  for (const type of ["pointerup", "pointerdown", "keydown", "click"]) {
    window.addEventListener(
      type,
      (e) => {
        if (e.isTrusted) gesture = Date.now();
      },
      true,
    );
  }

  // Handle capture event from in-page script
  window.addEventListener("deck:web-review-capture", (e) => {
    let raw = "";
    let comment = "";
    let steps = "";
    if (typeof e.detail === "string") {
      raw = e.detail;
    } else if (e.detail && typeof e.detail === "object") {
      raw = e.detail.raw || "";
      comment = e.detail.comment || "";
      steps = e.detail.steps || "";
    }
    if (!raw || raw.length > 24000) return;
    chrome.runtime
      .sendMessage({ type: "capture", raw, comment, steps })
      .then((res) => {
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

  // Handle note removal from in-page pin
  window.addEventListener("deck:web-review-remove-note", (e) => {
    const id = e.detail && typeof e.detail === "object" ? e.detail.id : e.detail;
    if (id) {
      chrome.runtime.sendMessage({ type: "remove", id }).catch(() => {});
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

  // Initial notes sync
  chrome.runtime
    .sendMessage({ type: "get_notes" })
    .then((reply) => {
      if (reply?.notes) {
        window.dispatchEvent(
          new CustomEvent("deck:web-review-sync-notes", {
            detail: JSON.stringify(reply.notes),
          }),
        );
      }
    })
    .catch(() => {});

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

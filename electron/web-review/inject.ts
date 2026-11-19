/** Runs only in the unprivileged page world; every emitted value is untrusted. */
export function reviewInjection(accent = "#4e8cff"): string {
  return `(${installReview.toString()})(${JSON.stringify(accent)})`;
}

// Kept as a script literal so the Electron compiler does not pull DOM globals into main.
const installReview = new Function(
  "accent",
  String.raw`
  if (window.__deckReview) return;

  const host = document.createElement("div");
  host.dataset.deckReview = "overlay";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "closed" });

  // Embedded CSS in Shadow DOM
  const style = document.createElement("style");
  style.textContent = [
    "* { box-sizing: border-box; }",
    ".dr-toolbar { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); display: none; align-items: center; gap: 3px; padding: 5px; max-width: calc(100vw - 24px); background: #202022; border: 1px solid #39393c; border-radius: 999px; box-shadow: 0 6px 20px #0003; pointer-events: auto; user-select: none; cursor: grab; touch-action: none; font: 13px/1.4 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif; color: #f5f5f5; }",
    ".dr-brand { display: flex; align-items: center; gap: 6px; padding: 0 9px; color: #bdbdc4; font-size: 12px; font-weight: 600; }",
    ".dr-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 6px 12px; background: transparent; border: 0; border-radius: 999px; color: #bdbdc4; font: inherit; cursor: pointer; transition: background-color 120ms ease, color 120ms ease; }",
    ".dr-btn:hover, .dr-btn-close:hover, .dr-popover-close:hover { background: #ffffff12; color: #fff; }",
    ".dr-btn.active { background: #414145; color: #fff; }",
    ".dr-divider { height: 18px; width: 1px; margin: 0 4px; background: #ffffff20; }",
    ".dr-badge { padding: 0 5px; color: #b0b0b8; font-size: 11px; white-space: nowrap; }",
    ".dr-btn-close, .dr-popover-close { display: grid; place-items: center; flex: 0 0 auto; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: #bdbdc4; cursor: pointer; }",
    "button:focus-visible, .dr-pin:focus-visible { outline: 2px solid " + accent + "; outline-offset: 3px; }",
    ".dr-box { position: fixed; display: none; border: 1px solid " + accent + "; background: #6f9cff0a; border-radius: 3px; pointer-events: none; }",
    ".dr-caption { position: absolute; bottom: calc(100% + 6px); left: 0; max-width: min(360px, calc(100vw - 24px)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 5px 8px; border-radius: 6px; background: #202022; color: #eeeef1; font: 12px/1.4 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif; pointer-events: none; }",
    ".dr-popover { position: fixed; display: none; width: 320px; max-width: calc(100vw - 24px); padding: 12px; background: #242426; border: 1px solid #414145; border-radius: 14px; box-shadow: 0 12px 32px #0003; z-index: 30; pointer-events: auto; color: #f5f5f5; font: 14px/1.5 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif; user-select: text; color-scheme: dark; }",
    ".dr-popover-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; min-width: 0; }",
    ".dr-tag { display: none; }",
    ".dr-target-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #d1d1d7; font-size: 13px; }",
    ".dr-textarea { display: block; width: 100%; height: 88px; min-height: 70px; max-height: 180px; margin: 0 0 12px; padding: 10px 12px; resize: vertical; background: #1b1b1d; border: 1px solid #48484d; border-radius: 8px; color: #f5f5f5; font: inherit; outline: none; caret-color: " + accent + "; }",
    ".dr-textarea::placeholder { color: #aaaab3; }",
    ".dr-textarea:focus { border-color: " + accent + "; box-shadow: 0 0 0 1px " + accent + "; }",
    ".dr-textarea::selection { background: #6f9cff50; }",
    ".dr-popover-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
    ".dr-popover-hint { color: #aaaab3; font-size: 11px; white-space: nowrap; }",
    ".dr-popover-actions { display: flex; align-items: center; gap: 6px; }",
    ".dr-btn-cancel, .dr-btn-save { min-height: 32px; padding: 6px 12px; border: 0; border-radius: 7px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }",
    ".dr-btn-cancel { background: transparent; color: #c5c5cd; }",
    ".dr-btn-cancel:hover { background: #ffffff0d; color: #fff; }",
    ".dr-btn-save { background: " + accent + "; color: #10141e; }",
    ".dr-btn-save:hover { filter: brightness(1.08); }",
    ".dr-pin { position: fixed; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; background: " + accent + "; border: 0; border-radius: 50%; color: #10141e; font: 600 12px/1 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif; box-shadow: 0 2px 5px #0003; z-index: 20; cursor: pointer; pointer-events: auto; user-select: none; }",
    ".dr-pin:hover { filter: brightness(1.12); }",
    "@media (max-width: 440px) { .dr-toolbar { top: 12px; } .dr-brand { padding: 0 5px; } .dr-brand span, .dr-badge { display: none; } .dr-btn { padding: 6px 9px; } }",
    ".dr-send { background: " + accent + "; color: #10141e; font-weight: 600; }",
    ".dr-delivery[hidden] { display: none; }",
    ".dr-send.sending svg { animation: dr-send-spin 1s linear infinite; }",
    "@keyframes dr-send-spin { to { transform: rotate(360deg); } }",
    ".dr-send:disabled { opacity: .55; cursor: wait; }",
    ".dr-delivery { position: absolute; top: calc(100% + 8px); left: 0; width: 100%; padding: 8px 12px; border-radius: 10px; background: #202022; color: #d1d1d7; font-size: 12px; line-height: 1.5; box-shadow: 0 4px 12px #0002; cursor: default; }",
    ".dr-dismiss { border: 0; background: transparent; color: #d1d1d7; font: inherit; text-decoration: underline; cursor: pointer; margin-left: 8px; }",
    "@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }",
  ].join("\n");
  shadow.append(style);

  // 1. Floating Pill Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "dr-toolbar";
  toolbar.innerHTML = [
    '<div class="dr-brand" title="Drag to move toolbar">',
    '  <svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    "  <span>Deck</span>",
    "</div>",
    '<button type="button" class="dr-btn active" data-mode="browse">Browse</button>',
    '<button type="button" class="dr-btn" data-mode="element">Element</button>',
    '<button type="button" class="dr-btn" data-mode="region">Region</button>',
    '<div class="dr-divider"></div>',
    '<button type="button" class="dr-btn dr-send" aria-label="Send to agent" title="Send to agent"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m22 2-7 20-4-9-9-4Z"/><path d="m22 2-11 11"/></svg></button>',
    '<div class="dr-delivery" hidden role="status" aria-live="polite"><span class="dr-delivery-text"></span><button type="button" class="dr-dismiss" hidden>Dismiss delivery</button></div>',
    '<button type="button" class="dr-btn-close" aria-label="Close toolbar" title="Close Toolbar (Esc)">✕</button>',
  ].join("");
  shadow.append(toolbar);

  // 2. Selection Box and Caption
  const box = document.createElement("div");
  box.className = "dr-box";
  const caption = document.createElement("span");
  caption.className = "dr-caption";
  box.append(caption);
  shadow.append(box);

  // 3. Floating Comment Popover
  const popover = document.createElement("div");
  popover.className = "dr-popover";
  popover.innerHTML = [
    '<div class="dr-popover-header">',
    '  <span class="dr-tag" id="dr-p-tag">ELEMENT</span>',
    '  <span class="dr-target-desc" id="dr-p-desc"></span>',
    '  <button type="button" class="dr-popover-close" id="dr-p-close" aria-label="Close comment" title="Close (Esc)">✕</button>',
    "</div>",
    '<textarea class="dr-textarea" id="dr-p-text" aria-label="Comment" placeholder="What should change here?"></textarea>',
    '<div class="dr-popover-footer">',
    '  <span class="dr-popover-hint">Ctrl+Enter to save</span>',
    '  <div class="dr-popover-actions">',
    '    <button type="button" class="dr-btn-cancel" id="dr-p-cancel">Cancel</button>',
    '    <button type="button" class="dr-btn-save" id="dr-p-save">Save</button>',
    "  </div>",
    "</div>",
  ].join("");
  shadow.append(popover);

  document.documentElement.append(host);

  let mode = "browse",
    hovered = null,
    start = null,
    chosen = null,
    pins = [],
    lastPoint = null,
    toolbarVisible = false,
    pendingTarget = null;

  const pTag = popover.querySelector("#dr-p-tag");
  const pDesc = popover.querySelector("#dr-p-desc");
  const pText = popover.querySelector("#dr-p-text");
  const pClose = popover.querySelector("#dr-p-close");
  const pCancel = popover.querySelector("#dr-p-cancel");
  const pSave = popover.querySelector("#dr-p-save");

  const trim = (value, max = 500) => String(value || "").slice(0, max);
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const bounds = (r) => ({
    x: Math.max(0, r.x),
    y: Math.max(0, r.y),
    width: Math.max(1, Math.min(innerWidth, r.x + r.width) - Math.max(0, r.x)),
    height: Math.max(1, Math.min(innerHeight, r.y + r.height) - Math.max(0, r.y)),
  });

  function under(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot && el.shadowRoot.elementFromPoint) {
      const next = el.shadowRoot.elementFromPoint(x, y);
      if (!next || next === el) break;
      el = next;
    }
    return el && el !== host ? el : null;
  }

  function selector(el) {
    if (!el || el.getRootNode() !== document) return "";
    for (const attr of ["data-testid", "data-test", "id"]) {
      const value = el.getAttribute(attr);
      if (value) {
        const s = "[" + attr + "=" + JSON.stringify(value) + "]";
        try {
          if (document.querySelectorAll(s).length === 1) return s;
        } catch {}
      }
    }
    const parts = [];
    for (let p = el; p && parts.length < 8; p = p.parentElement) {
      let s = p.tagName.toLowerCase();
      if (p.parentElement) {
        const siblings = [...p.parentElement.children].filter((n) => n.tagName === p.tagName);
        if (siblings.length > 1) s += ":nth-of-type(" + (siblings.indexOf(p) + 1) + ")";
      }
      parts.unshift(s);
      try {
        if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
      } catch {}
    }
    return parts.join(" > ");
  }

  function show(r, label) {
    Object.assign(box.style, {
      display: "block",
      left: r.x + "px",
      top: r.y + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
    const dims =
      r.width > 3 && r.height > 3
        ? " · " + Math.round(r.width) + "×" + Math.round(r.height) + "px"
        : "";
    caption.textContent = label + dims;
    caption.style.bottom = r.y < 32 ? "auto" : "calc(100% + 6px)";
    caption.style.top = r.y < 32 ? "calc(100% + 6px)" : "auto";
  }

  function componentInfo(el) {
    const components = [];
    let source = null;
    try {
      let fiber = null;
      for (let p = el; p && !fiber; p = p.parentElement) {
        const key = Object.keys(p).find((k) => k.startsWith("__reactFiber$"));
        if (key) fiber = p[key];
      }
      for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
        const t = fiber.type;
        const name = typeof t === "function" ? t.displayName || t.name : t && t.displayName;
        if (name && components.length < 12 && !components.includes(name))
          components.push(trim(name, 120));
        const s = fiber._debugSource;
        if (!source && s && s.fileName) source = trim(s.fileName + ":" + (s.lineNumber || 1), 1000);
      }
      const ng = window.ng;
      if (ng) {
        for (let p = el; p && components.length < 12; p = p.parentElement) {
          const c =
            (ng.getComponent && ng.getComponent(p)) ||
            (ng.getOwningComponent && ng.getOwningComponent(p));
          const name = c && c.constructor && c.constructor.name;
          if (name && !components.includes(name)) components.push(trim(name, 120));
        }
      }
    } catch {}
    return { components, source };
  }

  function evidence(el, rect, kind) {
    const attributes = {},
      styles = {};
    if (el) {
      for (const key of [
        "id",
        "class",
        "name",
        "type",
        "role",
        "aria-label",
        "aria-expanded",
        "aria-selected",
        "data-testid",
      ]) {
        const v = el.getAttribute(key);
        if (v) attributes[key] = trim(v);
      }
      const s = getComputedStyle(el);
      for (const key of [
        "color",
        "background-color",
        "font-size",
        "font-weight",
        "padding",
        "margin",
        "display",
        "gap",
        "border-radius",
      ]) {
        styles[key] = trim(s.getPropertyValue(key), 120);
      }
    }
    const dialog = el && el.closest('[role="dialog"],dialog');
    const info = componentInfo(el);
    return {
      kind,
      url: location.href,
      title: trim(document.title),
      capturedAt: Date.now(),
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scale: devicePixelRatio,
        scrollX,
        scrollY,
      },
      rect: bounds(rect),
      selector: kind === "element" ? selector(el) : "",
      tag: el ? el.tagName.toLowerCase() : "",
      text: trim(el && el.innerText, 1500),
      label: trim(
        el && (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText),
        160,
      ),
      role: trim(el && el.getAttribute("role"), 100),
      attributes,
      styles,
      ...info,
      headings: [...document.querySelectorAll('h1,h2,[role="heading"]')]
        .filter((n) => n.getClientRects().length)
        .slice(0, 8)
        .map((n) => trim(n.textContent, 200)),
      dialog: trim(
        dialog &&
          (dialog.getAttribute("aria-label") || dialog.querySelector("h1,h2,h3")?.textContent),
        300,
      ),
      selectedTab: trim(
        document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
        200,
      ),
    };
  }

  function openCommentPopover(el, r, kind) {
    pendingTarget = { el, r, kind, data: evidence(el, r, kind) };
    pTag.textContent = kind.toUpperCase();
    pDesc.textContent =
      kind === "region"
        ? Math.round(r.width) + " × " + Math.round(r.height) + " px"
        : pendingTarget.data.label ||
          pendingTarget.data.selector ||
          pendingTarget.data.tag ||
          "Element";

    // Position popover intelligently
    const popW = Math.min(320, innerWidth - 24);
    const popH = 210;
    let posX = Math.max(12, Math.min(innerWidth - popW - 12, r.x));
    let posY = r.y + r.height + 10;
    if (posY + popH > innerHeight - 12) {
      if (r.y - popH - 10 > 12) posY = r.y - popH - 10;
      else posY = Math.max(12, innerHeight - popH - 12);
    }

    popover.style.left = posX + "px";
    popover.style.top = posY + "px";
    popover.style.display = "block";

    // Show persistent active selection frame
    show(r, "Selected");

    pText.value = "";
    setTimeout(() => pText.focus(), 50);
  }

  function closeCommentPopover() {
    popover.style.display = "none";
    if (!pendingTarget) box.style.display = "none";
    pendingTarget = null;
  }

  function saveComment() {
    if (!pendingTarget) return;
    const comment = pText.value.trim() || "Review this " + pendingTarget.kind;
    pendingTarget.data.comment = comment;

    popover.style.display = "none";
    box.style.display = "none";

    if (pendingTarget.id) {
      window.dispatchEvent(
        new CustomEvent("deck:web-review-edit-note", {
          detail: JSON.stringify({ id: pendingTarget.id, comment }),
        }),
      );
    } else {
      window.dispatchEvent(
        new CustomEvent("deck:web-review-capture", {
          detail: JSON.stringify(pendingTarget.data),
        }),
      );
    }

    pendingTarget = null;
    setMode("browse");
  }

  pClose.onclick = closeCommentPopover;
  pCancel.onclick = () => {
    if (pendingTarget?.id) {
      window.dispatchEvent(
        new CustomEvent("deck:web-review-remove-note", {
          detail: pendingTarget.id,
        }),
      );
    }
    closeCommentPopover();
    box.style.display = "none";
  };
  pSave.onclick = saveComment;

  pText.onkeydown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveComment();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCommentPopover();
    }
  };

  function setMode(value) {
    mode = value;
    start = null;
    chosen = null;
    host.style.visibility = "visible";
    box.style.display = "none";

    toolbar.querySelectorAll(".dr-btn[data-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
      btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
    });

    if (mode === "element" && lastPoint) {
      hovered = under(lastPoint.x, lastPoint.y);
      if (hovered) show(rectOf(hovered), "Click to inspect");
    }
  }

  function toggleToolbar() {
    toolbarVisible = !toolbarVisible;
    window.dispatchEvent(new CustomEvent("deck:web-review-ready", { detail: toolbarVisible ? "open" : "closed" }));
    toolbar.style.display = toolbarVisible ? "flex" : "none";
    if (toolbarVisible) {
      host.style.visibility = "visible";
      setMode("browse");
      deliveryText.parentElement.hidden = true;
    } else {
      setMode("browse");
      closeCommentPopover();
    }
  }

  const sendButton = toolbar.querySelector(".dr-send");
  const deliveryText = toolbar.querySelector(".dr-delivery-text");
  const dismissButton = toolbar.querySelector(".dr-dismiss");
  sendButton.onclick = (e) => {
    if (!e.isTrusted) return;
    if (pendingTarget) { deliveryText.parentElement.hidden = false; deliveryText.textContent = "Save or cancel the open comment first."; return; }
    window.dispatchEvent(new CustomEvent("deck:web-review-send"));
  };
  dismissButton.onclick = (e) => {
    if (!e.isTrusted || !confirm("Check the agent conversation first. Dismiss this delivery? It will not be sent again automatically.")) return;
    window.dispatchEvent(new CustomEvent("deck:web-review-dismiss"));
  };
  window.addEventListener("deck:web-review-delivery", (e) => {
    try {
      const state = JSON.parse(e.detail);
      sendButton.disabled = !!state.sending;
      dismissButton.hidden = !state.pending || !!state.sending;
      sendButton.classList.toggle("sending", !!state.sending);
      sendButton.setAttribute("aria-busy", String(!!state.sending));
      deliveryText.textContent = state.error || state.message || "";
      deliveryText.parentElement.hidden = !deliveryText.textContent && !state.pending;

    } catch {}
  });

  let toolbarDrag = null;
  function placeToolbar(x, y) {
    const r = toolbar.getBoundingClientRect();
    toolbar.style.transform = "none";
    toolbar.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x)) + "px";
    toolbar.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, y)) + "px";
  }
  toolbar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.target.closest(".dr-brand")) return;
    const r = toolbar.getBoundingClientRect();
    toolbarDrag = { id: e.pointerId, dx: e.clientX - r.x, dy: e.clientY - r.y };
    toolbar.setPointerCapture(e.pointerId);
    toolbar.style.cursor = "grabbing";
    e.preventDefault();
  });
  toolbar.addEventListener("pointermove", (e) => {
    if (!toolbarDrag || toolbarDrag.id !== e.pointerId) return;
    placeToolbar(e.clientX - toolbarDrag.dx, e.clientY - toolbarDrag.dy);
  });
  const endToolbarDrag = () => {
    toolbarDrag = null;
    toolbar.style.cursor = "";
  };
  toolbar.addEventListener("lostpointercapture", endToolbarDrag);
  toolbar.addEventListener("pointercancel", endToolbarDrag);
  toolbar.addEventListener("pointerup", (e) => {
    if (!toolbarDrag || toolbarDrag.id !== e.pointerId) return;
    toolbar.releasePointerCapture(e.pointerId);
    endToolbarDrag();
  });
  addEventListener("resize", () => {
    if (!toolbarVisible || !toolbar.style.left) return;
    const r = toolbar.getBoundingClientRect();
    placeToolbar(r.x, r.y);
  });

  toolbar.querySelectorAll(".dr-btn[data-mode]").forEach((btn) => {
    btn.onclick = () => setMode(btn.dataset.mode);
  });
  toolbar.querySelector(".dr-btn-close").onclick = () => toggleToolbar();

  // Events from the closed shadow root are retargeted to the overlay host.
  function isReviewControl(e) {
    return e.composedPath().includes(host);
  }

  function move(e) {
    if (isReviewControl(e)) return;
    if (mode === "browse" || popover.style.display === "block") return;
    lastPoint = { x: e.clientX, y: e.clientY };
    if (mode === "region" && start) {
      show(
        {
          x: Math.min(start.x, e.clientX),
          y: Math.min(start.y, e.clientY),
          width: Math.abs(start.x - e.clientX),
          height: Math.abs(start.y - e.clientY),
        },
        "Select region",
      );
      return;
    }
    if (mode === "element") {
      hovered = under(e.clientX, e.clientY);
      chosen = null;
      if (hovered)
        show(
          rectOf(hovered),
          trim(hovered.getAttribute("aria-label") || hovered.tagName.toLowerCase()) +
            " · Click to comment",
        );
    }
  }

  function down(e) {
    if (isReviewControl(e)) return;
    if (mode === "browse" || popover.style.display === "block" || e.button !== 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (mode === "region") {
      start = { x: e.clientX, y: e.clientY };
    }
  }

  function up(e) {
    if (isReviewControl(e)) return;
    if (mode !== "region" || !start || popover.style.display === "block") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const r = {
      x: Math.min(start.x, e.clientX),
      y: Math.min(start.y, e.clientY),
      width: Math.abs(start.x - e.clientX),
      height: Math.abs(start.y - e.clientY),
    };
    if (r.width < 4 || r.height < 4) {
      start = null;
      return;
    }
    openCommentPopover(under(r.x + r.width / 2, r.y + r.height / 2), r, "region");
  }

  let suppressClick = false;
  function click(e) {
    if (isReviewControl(e)) {
      suppressClick = false;
      return;
    }
    if (suppressClick) {
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressClick = false;
      return;
    }
    if (mode === "browse" || popover.style.display === "block") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (mode === "region") {
      if (!chosen) {
        chosen = { x: e.clientX, y: e.clientY };
        show({ x: e.clientX, y: e.clientY, width: 2, height: 2 }, "Click the opposite corner");
      } else {
        const r = {
          x: Math.min(chosen.x, e.clientX),
          y: Math.min(chosen.y, e.clientY),
          width: Math.abs(chosen.x - e.clientX),
          height: Math.abs(chosen.y - e.clientY),
        };
        if (r.width > 3 && r.height > 3) {
          openCommentPopover(under(r.x + r.width / 2, r.y + r.height / 2), r, "region");
        }
      }
      return;
    }
    const el = chosen || under(e.clientX, e.clientY);
    if (el) openCommentPopover(el, rectOf(el), "element");
  }

  function key(e) {
    // Alt+X toggle shortcut
    if (e.altKey && (e.key === "x" || e.key === "X")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleToolbar();
      return;
    }
    if (e.key === "Escape") {
      if (popover.style.display === "block") {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeCommentPopover();
        return;
      }
      if (mode !== "browse") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setMode("browse");
        return;
      }
      if (toolbarVisible) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleToolbar();
        return;
      }
    }
    if (
      mode === "element" &&
      ["ArrowUp", "ArrowDown", "Enter"].includes(e.key) &&
      popover.style.display !== "block"
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      let el = chosen || hovered || document.activeElement;
      if (e.key === "ArrowUp") el = el && el.parentElement;
      if (e.key === "ArrowDown") el = el && el.firstElementChild;
      if (!el || el === host) return;
      chosen = el;
      show(rectOf(el), el.tagName.toLowerCase() + " · Enter comment");
      if (e.key === "Enter") openCommentPopover(el, rectOf(el), "element");
    }
  }

  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerdown", down, true);
  document.addEventListener(
    "pointerup",
    (e) => {
      if (isReviewControl(e)) return;
      const selected =
        mode === "region" && start && Math.hypot(start.x - e.clientX, start.y - e.clientY) > 5;
      up(e);
      if (selected) suppressClick = true;
    },
    true,
  );
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);

  function drawPins() {
    shadow.querySelectorAll(".dr-pin").forEach((n) => n.remove());
    for (const p of pins) {
      if (p.url !== location.href) continue;
      let r = null;
      if (p.selector) {
        try {
          const els = document.querySelectorAll(p.selector);
          if (els.length === 1 && (!p.text || trim(els[0].innerText, 1500) === p.text))
            r = rectOf(els[0]);
        } catch {}
      } else if (
        p.kind === "region" &&
        p.rect &&
        innerWidth === p.viewport?.width &&
        innerHeight === p.viewport?.height
      ) {
        r = {
          ...p.rect,
          x: p.rect.x + (p.viewport.scrollX || 0) - scrollX,
          y: p.rect.y + (p.viewport.scrollY || 0) - scrollY,
        };
      } else if (p.rect) {
        r = p.rect;
      }
      // Dynamic text can change while the screenshot is being saved. Keep the
      // saved annotation visible at its captured position until its target resolves.
      if (!r && p.rect && p.viewport && innerWidth === p.viewport.width && innerHeight === p.viewport.height) {
        r = { ...p.rect, x: p.rect.x + (p.viewport.scrollX || 0) - scrollX,
          y: p.rect.y + (p.viewport.scrollY || 0) - scrollY };
      }
      if (!r || r.y + r.height < 0 || r.y > innerHeight) continue;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.setAttribute("aria-label", "Edit comment " + p.number);
      pin.className = "dr-pin";
      pin.dataset.pin = p.id;
      pin.textContent = String(p.number);
      pin.style.left = Math.max(0, r.x) + "px";
      pin.style.top = Math.max(0, r.y) + "px";
      pin.title = p.comment || "Review comment #" + p.number;

      pin.onclick = (e) => {
        e.stopPropagation();
        if (p.comment) {
          openCommentPopover(null, r, p.kind || "element");
          pendingTarget.id = p.id;
          pText.value = p.comment;
        }
      };

      shadow.append(pin);
    }
  }

  let scheduled = false;
  const redraw = () => {
    if (!pins.length || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      drawPins();
    });
  };
  addEventListener("scroll", redraw, true);
  addEventListener("resize", redraw);

  // Custom events from bridge
  window.addEventListener("deck:web-review-toggle-toolbar", () => {
    toggleToolbar();
  });
  window.addEventListener("deck:web-review-sync-notes", (e) => {
    try {
      const list = JSON.parse(e.detail);
      if (Array.isArray(list)) {
        pins = list.map((n, i) => ({
          id: n.id,
          number: i + 1,
          selector: n.capture?.selector,
          rect: n.capture?.rect,
          kind: n.capture?.kind,
          viewport: n.capture?.viewport,
          url: n.capture?.url,
          comment: n.comment,
          text: n.capture?.text,
        }));
        host.style.visibility = "visible";
        drawPins();
      }
    } catch {}
  });

  window.addEventListener("deck:web-review-capture-result", (e) => {
    try {
      const result = JSON.parse(e.detail);
      if (result.error) {
        deliveryText.textContent = result.error;
        deliveryText.parentElement.hidden = false;
      }
      if (result.success) drawPins();
    } catch {}
  });

  window.__deckReview = {
    setMode(value) {
      if (value !== "browse" && !toolbarVisible) {
        toolbarVisible = true;
        toolbar.style.display = "flex";
      }
      setMode(value);
    },
    toggleToolbar,
    setPins(value) {
      pins = value;
      host.style.visibility = "visible";
      drawPins();
    },
    reveal(p) {
      if (p.url !== location.href) return false;
      let el = null;
      try {
        const matches = p.selector ? document.querySelectorAll(p.selector) : [];
        if (matches.length === 1) el = matches[0];
      } catch {}
      if (el && (!p.text || trim(el.innerText, 1500) === p.text)) {
        el.scrollIntoView({ block: "center" });
        show(rectOf(el), "Selected comment");
        setTimeout(() => (box.style.display = "none"), 1600);
        return true;
      }
      if (!p.selector && innerWidth === p.viewport.width) {
        scrollTo(p.viewport.scrollX, p.viewport.scrollY);
        show(p.rect, "Captured region");
        setTimeout(() => (box.style.display = "none"), 1600);
        return true;
      }
      return false;
    },
  };
  window.dispatchEvent(new CustomEvent("deck:web-review-ready"));
`,
);

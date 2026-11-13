(function anonymous(accent) {
  if (window.__deckReview) return;

  const host = document.createElement("div");
  host.dataset.deckReview = "overlay";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "closed" });

  // Embedded CSS in Shadow DOM
  const style = document.createElement("style");
  style.textContent = [
    "* { box-sizing: border-box; }",
    ".dr-toolbar {",
    "  position: fixed; top: 16px; left: 50%; transform: translateX(-50%);",
    "  display: none; align-items: center;",
    "  background: rgba(14, 16, 22, 0.94); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);",
    "  border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.4);",
    "  border-radius: 9999px; padding: 4px 6px; gap: 3px; z-index: 2147483647;",
    "  pointer-events: auto; user-select: none;",
    '  font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #f0f3f8;',
    "  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);",
    "}",
    ".dr-brand {",
    "  display: flex; align-items: center; gap: 6px; padding: 0 6px 0 6px;",
    "  color: " + accent + "; font-weight: 700; font-size: 11px; letter-spacing: -0.01em;",
    "}",
    ".dr-btn {",
    "  display: inline-flex; align-items: center; gap: 6px;",
    "  background: transparent; border: 1px solid transparent; border-radius: 9999px;",
    "  padding: 6px 11px; color: #9da4b2; font: inherit; font-weight: 550;",
    "  cursor: pointer; transition: all 0.15s ease;",
    "}",
    ".dr-btn:hover:not(.active) { background: rgba(255, 255, 255, 0.08); color: #f0f3f8; }",
    ".dr-btn.active {",
    "  background: rgba(255, 255, 255, 0.14); border-color: rgba(255, 255, 255, 0.18);",
    "  color: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);",
    "}",
    ".dr-divider { width: 1px; height: 16px; background: rgba(255, 255, 255, 0.1); margin: 0 2px; }",
    ".dr-badge { font-size: 10px; color: #717886; padding: 0 4px; font-family: ui-monospace, monospace; }",
    ".dr-btn-close {",
    "  background: transparent; border: 0; color: #717886; width: 22px; height: 22px;",
    "  border-radius: 50%; cursor: pointer; display: grid; place-items: center; margin-left: 2px;",
    "}",
    ".dr-btn-close:hover { background: rgba(255, 255, 255, 0.1); color: #f0f3f8; }",
    ".dr-box {",
    "  position: fixed; box-sizing: border-box; display: none;",
    "  border: 2px solid " + accent + "; background: rgba(78, 140, 255, 0.08);",
    "  box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 0 16px rgba(78, 140, 255, 0.25);",
    "  border-radius: 4px; pointer-events: none;",
    "  transition: top 0.04s ease, left 0.04s ease, width 0.04s ease, height 0.04s ease;",
    "}",
    ".dr-caption {",
    "  position: absolute; bottom: calc(100% + 6px); left: 0;",
    '  font: 500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    "  background: rgba(15, 18, 24, 0.94); backdrop-filter: blur(8px);",
    "  border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 4px 14px rgba(0,0,0,0.45);",
    "  color: #f0f3f8; padding: 4px 9px; white-space: nowrap; border-radius: 6px;",
    "  pointer-events: none; display: inline-flex; align-items: center; gap: 6px; z-index: 10;",
    "}",
    ".dr-popover {",
    "  position: fixed; display: none; width: 330px;",
    "  background: rgba(17, 20, 28, 0.96); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);",
    "  border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 12px;",
    "  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(0, 0, 0, 0.4);",
    "  padding: 12px; z-index: 2147483647; pointer-events: auto;",
    '  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #f0f3f8;',
    "  user-select: text;",
    "}",
    ".dr-popover-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; gap: 8px; }",
    ".dr-tag {",
    "  font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;",
    "  padding: 2px 6px; border-radius: 3px; background: rgba(78, 140, 255, 0.18); color: " +
      accent +
      ";",
    "}",
    ".dr-target-desc {",
    '  font-family: ui-monospace, "SF Mono", monospace; font-size: 11px; color: #9da4b2;',
    "  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;",
    "}",
    ".dr-popover-close {",
    "  background: transparent; border: 0; color: #717886; width: 20px; height: 20px;",
    "  cursor: pointer; border-radius: 4px; display: grid; place-items: center; font-size: 12px;",
    "}",
    ".dr-popover-close:hover { color: #f0f3f8; background: rgba(255, 255, 255, 0.08); }",
    ".dr-textarea {",
    "  width: 100%; height: 74px; background: #090a0d;",
    "  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px;",
    "  padding: 8px 10px; font: inherit; font-size: 12px; line-height: 1.5; color: #f0f3f8;",
    "  resize: vertical; outline: none; margin-bottom: 8px; display: block;",
    "}",
    ".dr-textarea:focus { border-color: " +
      accent +
      "; box-shadow: 0 0 0 2px rgba(78, 140, 255, 0.22); }",
    ".dr-popover-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
    ".dr-popover-hint { font-size: 10px; color: #717886; font-family: ui-monospace, monospace; }",
    ".dr-popover-actions { display: flex; align-items: center; gap: 6px; }",
    ".dr-btn-cancel {",
    "  background: transparent; border: 0; color: #9da4b2; font: inherit; font-size: 11px;",
    "  padding: 5px 9px; border-radius: 4px; cursor: pointer;",
    "}",
    ".dr-btn-cancel:hover { color: #f0f3f8; background: rgba(255, 255, 255, 0.06); }",
    ".dr-btn-save {",
    "  background: " +
      accent +
      "; border: 0; color: #0c0d10; font: inherit; font-weight: 650; font-size: 11px;",
    "  padding: 6px 13px; border-radius: 5px; cursor: pointer; box-shadow: 0 2px 8px rgba(78, 140, 255, 0.35);",
    "}",
    ".dr-btn-save:hover { filter: brightness(1.1); }",
    ".dr-pin {",
    "  position: fixed; border-radius: 50%; width: 22px; height: 22px; display: grid; place-items: center;",
    "  background: " + accent + "; color: #0c0d10; font: 700 11px -apple-system, sans-serif;",
    "  box-shadow: 0 2px 8px rgba(0,0,0,0.5), 0 0 0 2px rgba(255,255,255,0.9); z-index: 20;",
    "  cursor: pointer; pointer-events: auto; user-select: none; transition: transform 0.15s ease;",
    "}",
    ".dr-pin:hover { transform: scale(1.15); }",
  ].join("\n");
  shadow.append(style);

  // 1. Floating Pill Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "dr-toolbar";
  toolbar.innerHTML = [
    '<div class="dr-brand">',
    '  <svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    "  <span>Deck</span>",
    "</div>",
    '<button type="button" class="dr-btn active" data-mode="browse">Browse</button>',
    '<button type="button" class="dr-btn" data-mode="element">Element</button>',
    '<button type="button" class="dr-btn" data-mode="region">Region</button>',
    '<div class="dr-divider"></div>',
    '<span class="dr-badge">Alt+X</span>',
    '<button type="button" class="dr-btn-close" title="Close Toolbar (Esc)">✕</button>',
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
    '  <button type="button" class="dr-popover-close" id="dr-p-close" title="Cancel (Esc)">✕</button>',
    "</div>",
    '<textarea class="dr-textarea" id="dr-p-text" placeholder="What should change here? (e.g. adjust padding, fix alignment)"></textarea>',
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
    const popW = 330;
    const popH = 170;
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

    window.dispatchEvent(
      new CustomEvent("deck:web-review-capture", {
        detail: JSON.stringify(pendingTarget.data),
      }),
    );

    // Add immediate pin locally for instant feedback
    pins.push({
      id: "local-" + Date.now(),
      number: pins.length + 1,
      selector: pendingTarget.data.selector,
      rect: pendingTarget.r,
      kind: pendingTarget.kind,
      url: location.href,
      comment: comment,
      text: pendingTarget.data.text,
    });
    drawPins();

    pendingTarget = null;
    setMode("browse");
  }

  pClose.onclick = closeCommentPopover;
  pCancel.onclick = closeCommentPopover;
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

    toolbar.querySelectorAll(".dr-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    if (mode === "element" && lastPoint) {
      hovered = under(lastPoint.x, lastPoint.y);
      if (hovered) show(rectOf(hovered), "Click to inspect");
    }
  }

  function toggleToolbar() {
    toolbarVisible = !toolbarVisible;
    toolbar.style.display = toolbarVisible ? "flex" : "none";
    if (toolbarVisible) {
      host.style.visibility = "visible";
      setMode("element");
    } else {
      setMode("browse");
      closeCommentPopover();
    }
  }

  toolbar.querySelectorAll(".dr-btn").forEach((btn) => {
    btn.onclick = () => setMode(btn.dataset.mode);
  });
  toolbar.querySelector(".dr-btn-close").onclick = () => toggleToolbar();

  function move(e) {
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
    if (mode === "browse" || popover.style.display === "block" || e.button !== 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (mode === "region") {
      start = { x: e.clientX, y: e.clientY };
    }
  }

  function up(e) {
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
      if (!r || r.y + r.height < 0 || r.y > innerHeight) continue;
      const pin = document.createElement("span");
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
        drawPins();
      }
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
})("#6f9cff");

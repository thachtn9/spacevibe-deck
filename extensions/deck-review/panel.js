const $ = (id) => document.getElementById(id);
let snapshot = null,
  notes = [],
  selected = "",
  pendingBatch = null,
  working = false;
let edits = Promise.resolve();
let settingsOpen = false;

const tell = (text) => {
  $("status").textContent = text;
  $("status").classList.toggle("quiet", text === "Connected to Deck");
};

async function request(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (reply?.error) throw new Error(reply.error);
  return reply?.value;
}

const option = (value, text) => {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = text;
  return node;
};

function target() {
  return snapshot?.targets.find(
    (t) => `${t.clientId}:${t.paneId}` === $("target").value && t.root === $("source").value,
  );
}

function controls() {
  $("unlock").hidden = !pendingBatch;
  $("note-count").textContent = notes.length;
  const t = target();
  const stateBadge = $("target-state");
  if (t) {
    if (t.phase === "working") {
      stateBadge.textContent = "Agent working";
      stateBadge.style.color = "var(--warning)";
    } else {
      stateBadge.textContent = "Agent ready";
      stateBadge.style.color = "var(--success)";
    }
  } else {
    stateBadge.textContent = "Choose conversation";
    stateBadge.style.color = "var(--text-secondary)";
  }

  const lastNote = notes.at(-1);
  if (lastNote?.capture.title) {
    $("page-name").textContent = lastNote.capture.title;
  } else if (lastNote?.capture.url) {
    try {
      $("page-name").textContent = new URL(lastNote.capture.url).hostname;
    } catch {
      $("page-name").textContent = "Your browser, in review";
    }
  } else {
    $("page-name").textContent = "Your browser, in review";
  }

  const sendSpan = $("send").querySelector("span");
  const sendLabel = pendingBatch
    ? "Retry pending delivery"
    : `Queue ${notes.length} ${notes.length === 1 ? "comment" : "comments"}`;
  if (sendSpan) sendSpan.textContent = sendLabel;
  else $("send").textContent = sendLabel;

  $("send").disabled =
    working ||
    (!pendingBatch && (!target() || !notes.length || notes.some((n) => !n.comment.trim())));
}

function targets() {
  const previous = $("target").value;
  $("target").replaceChildren(option("", "Select existing conversation"));
  for (const t of snapshot?.targets || [])
    if (t.root === $("source").value)
      $("target").append(
        option(`${t.clientId}:${t.paneId}`, t.label + (t.phase === "working" ? " · working" : "")),
      );
  $("target").value = previous;
  controls();
}

async function refresh() {
  try {
    snapshot = await request({ type: "state" });
    $("pairing").hidden = !settingsOpen;
    const connLabel = $("connection").querySelector(".status-label");
    if (connLabel) connLabel.textContent = "Connected";
    else $("connection").textContent = "Connected";
    $("connection").classList.add("online");
    $("workspace").hidden = false;

    const previous = $("source").value || (await chrome.storage.local.get("source")).source || "";
    $("source").replaceChildren(option("", "Select source in Deck"));
    for (const root of snapshot.roots) $("source").append(option(root, root));
    $("source").value = previous;
    targets();

    $("queue").replaceChildren();
    let count = 0;
    for (const p of snapshot.projects)
      for (const b of p.batches.slice().reverse()) {
        if (b.status === "cancelled") continue;
        count++;

        const article = document.createElement("article");
        article.className = "delivery-item";

        const header = document.createElement("div");
        header.className = "delivery-header";

        const title = document.createElement("span");
        title.className = "delivery-title";
        title.textContent = `${b.count} ${b.count === 1 ? "comment" : "comments"}`;

        const badge = document.createElement("span");
        badge.className = "delivery-state";
        badge.dataset.status = b.status;
        badge.textContent =
          {
            queued: "Waiting",
            dispatching: "Sending",
            sent: "Sent",
            staged: "Check composer",
            uncertain: "Check delivery",
          }[b.status] || b.status;
        header.append(title, badge);

        const targetP = document.createElement("p");
        targetP.className = "delivery-target";
        targetP.textContent = b.target;

        const detail = document.createElement("p");
        detail.className = "delivery-message";
        detail.textContent = b.message;

        article.append(header, targetP, detail);

        if (["queued", "staged", "uncertain"].includes(b.status)) {
          const actions = document.createElement("div");
          actions.className = "delivery-actions";
          const cancel = document.createElement("button");
          cancel.className = "secondary-button";
          cancel.textContent =
            b.status === "queued" ? "Cancel batch" : "I checked the conversation";
          cancel.onclick = () =>
            request({ type: "cancel", id: b.id })
              .then(refresh)
              .catch((e) => tell(e.message));
          actions.append(cancel);
          article.append(actions);
        }
        $("queue").append(article);
      }
    $("delivery-count").textContent = count;
    $("queue-empty").hidden = count > 0;
    tell(
      pendingBatch
        ? "Delivery unconfirmed. Retry uses the same batch ID and will not duplicate it."
        : "Connected to Deck",
    );
  } catch (e) {
    snapshot = null;
    const connLabel = $("connection").querySelector(".status-label");
    if (connLabel) connLabel.textContent = "Offline";
    else $("connection").textContent = "Offline";
    $("connection").classList.remove("online");
    $("workspace").hidden = true;
    $("pairing").hidden = false;
    tell("Deck unavailable or not paired. Open Deck and connect again. " + e.message);
    controls();
  }
}

async function crop(note, image) {
  const bitmap = await createImageBitmap(await (await fetch(note.image)).blob());
  const { rect, viewport } = note.capture;
  const sx = bitmap.width / viewport.width,
    sy = bitmap.height / viewport.height;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * sx));
  canvas.height = Math.max(1, Math.round(rect.height * sy));
  canvas
    .getContext("2d")
    .drawImage(
      bitmap,
      rect.x * sx,
      rect.y * sy,
      rect.width * sx,
      rect.height * sy,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  bitmap.close();
  image.src = canvas.toDataURL("image/png");
}

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.max(70, textarea.scrollHeight) + "px";
}

function renderNotes() {
  $("notes").replaceChildren();
  $("empty").hidden = notes.length > 0;
  if (selected && !notes.some((n) => n.id === selected)) selected = notes.at(-1)?.id || "";

  notes.forEach((note, index) => {
    const article = document.createElement("article"),
      summary = document.createElement("button"),
      thumb = document.createElement("img"),
      copy = document.createElement("span"),
      badgeRow = document.createElement("div"),
      typeTag = document.createElement("span"),
      targetName = document.createElement("span"),
      title = document.createElement("strong"),
      number = document.createElement("span");

    const open = selected === note.id;
    article.className = "note" + (open ? " is-selected" : "");
    summary.className = "note-summary";
    summary.setAttribute("aria-expanded", String(open));
    thumb.className = "note-thumb";
    thumb.alt = "";
    void crop(note, thumb).catch((e) => tell(e.message));

    copy.className = "note-copy";
    badgeRow.className = "note-badge-row";
    typeTag.className = "note-type-tag " + (note.capture.kind === "region" ? "region" : "element");
    typeTag.textContent = note.capture.kind === "region" ? "Region" : "Element";

    targetName.className = "note-target-name";
    targetName.textContent =
      note.capture.kind === "region"
        ? `${Math.round(note.capture.rect.width)} × ${Math.round(note.capture.rect.height)} px`
        : note.capture.label || note.capture.selector || note.capture.tag || "Element";

    badgeRow.append(typeTag, targetName);
    title.textContent = note.comment || "Describe your change…";
    copy.append(badgeRow, title);

    number.className = "note-number";
    number.textContent = `#${String(index + 1).padStart(2, "0")}`;

    summary.append(thumb, copy, number);
    summary.onclick = () => {
      selected = open ? "" : note.id;
      renderNotes();
    };
    article.append(summary);

    if (open) {
      const editor = document.createElement("div"),
        image = document.createElement("img"),
        label = document.createElement("label"),
        comment = document.createElement("textarea"),
        details = document.createElement("details"),
        heading = document.createElement("summary"),
        stepsContainer = document.createElement("div"),
        stepsLabel = document.createElement("label"),
        steps = document.createElement("textarea"),
        contextDetails = document.createElement("details"),
        contextHeading = document.createElement("summary"),
        contextContainer = document.createElement("div"),
        context = document.createElement("p"),
        actions = document.createElement("div"),
        remove = document.createElement("button");

      editor.className = "note-editor";
      image.className = "note-editor-preview";
      image.alt = "Selected area at capture time";
      void crop(note, image).catch((e) => tell(e.message));

      label.append("Requested change", comment);
      comment.value = note.comment;
      comment.maxLength = 8000;
      comment.disabled = Boolean(pendingBatch);
      comment.placeholder = "What should change here? (e.g. adjust padding, fix alignment)";

      heading.textContent = "Steps and expected behavior";
      stepsContainer.className = "details-content";
      stepsLabel.append("Additional context & reproduction steps", steps);
      steps.value = note.steps;
      steps.maxLength = 4000;
      steps.disabled = Boolean(pendingBatch);
      stepsContainer.append(stepsLabel);
      details.append(heading, stepsContainer);

      contextHeading.textContent = "Captured context & diagnostics";
      contextContainer.className = "details-content";
      context.className = "note-context";
      context.textContent = [
        "URL: " + note.capture.url,
        note.capture.selector && "Selector: " + note.capture.selector,
        "Viewport: " + note.capture.viewport.width + " × " + note.capture.viewport.height,
        note.capture.dialog && "Dialog: " + note.capture.dialog,
        note.capture.selectedTab && "Tab: " + note.capture.selectedTab,
        note.capture.source && "Source: " + note.capture.source,
      ]
        .filter(Boolean)
        .join("\n");
      contextContainer.append(context);
      contextDetails.append(contextHeading, contextContainer);

      const save = () => {
        note.comment = comment.value;
        note.steps = steps.value;
        title.textContent = note.comment || "Describe your change…";
        controls();
        const data = { type: "edit", id: note.id, comment: note.comment, steps: note.steps };
        edits = edits.catch(() => {}).then(() => request(data));
        void edits.catch((e) => tell(e.message));
      };

      comment.oninput = () => {
        autoResize(comment);
        save();
      };
      steps.oninput = () => {
        autoResize(steps);
        save();
      };

      comment.onkeydown = (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          if (!$("send").disabled) $("send").click();
        }
      };

      remove.className = "btn-remove";
      remove.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg> Discard`;
      remove.disabled = Boolean(pendingBatch);
      remove.onclick = () => request({ type: "remove", id: note.id }).catch((e) => tell(e.message));

      actions.className = "note-actions";
      actions.append(remove);
      editor.append(image, label, details, contextDetails, actions);
      article.append(editor);

      setTimeout(() => {
        autoResize(comment);
        if (note.steps) autoResize(steps);
        if (!note.comment) comment.focus();
      }, 0);
    }
    $("notes").append(article);
  });
  controls();
}

async function loadNotes() {
  const data = await chrome.storage.local.get(["notes", "selected", "pendingBatch", "notice"]);
  const structureChanged =
    notes.map((n) => n.id).join() !== (data.notes || []).map((n) => n.id).join() ||
    Boolean(pendingBatch) !== Boolean(data.pendingBatch);
  notes = data.notes || [];
  if (structureChanged) {
    selected = data.selected || "";
    switchView("comments");
  }
  pendingBatch = data.pendingBatch || null;
  if (structureChanged || !$("notes").childElementCount) renderNotes();
  controls();
  if (data.notice) tell(data.notice);
}

$("pair-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await request({ type: "pair", code: $("code").value.trim() });
    $("code").value = "";
    await refresh();
  } catch (e) {
    tell(e.message);
  }
};

$("refresh").onclick = refresh;
$("source").onchange = () => {
  chrome.storage.local.set({ source: $("source").value });
  targets();
};
$("target").onchange = controls;

function switchView(view) {
  for (const name of ["comments", "delivery"]) {
    $(name + "-view").hidden = name !== view;
    $(name + "-tab").setAttribute("aria-selected", String(name === view));
    $(name + "-tab").tabIndex = name === view ? 0 : -1;
  }
}

for (const view of ["comments", "delivery"]) $(view + "-tab").onclick = () => switchView(view);

$("settings").onclick = () => {
  settingsOpen = !settingsOpen;
  $("pairing").hidden = !settingsOpen;
};

for (const mode of ["element", "region", "browse"])
  $(mode).onclick = async () => {
    try {
      await request({ type: "mode", mode });
      for (const name of ["element", "region", "browse"])
        $(name).setAttribute("aria-pressed", String(name === mode));
      $("tool-hint").textContent =
        mode === "browse"
          ? "Select an element or region to leave precise feedback."
          : mode === "element"
            ? "Click an element. ↑ selects its parent. Enter confirms. Esc cancels."
            : "Drag a region or click two corners. Esc cancels.";
      switchView("comments");
    } catch (e) {
      tell(e.message);
    }
  };

$("send").onclick = async () => {
  working = true;
  controls();
  try {
    await edits;
    notes = (await chrome.storage.local.get("notes")).notes || [];
    if (!pendingBatch) {
      const t = target();
      if (!t) throw new Error("Select a live conversation.");
      pendingBatch = {
        id: crypto.randomUUID(),
        root: t.root,
        clientId: t.clientId,
        paneId: t.paneId,
        sessionId: t.sessionId,
        annotations: structuredClone(notes),
      };
      await chrome.storage.local.set({ pendingBatch });
      renderNotes();
    }
    await request({ type: "batch", batch: pendingBatch });
    const sent = new Set(pendingBatch.annotations.map((n) => n.id));
    const stored = await chrome.storage.local.get("notes");
    await chrome.storage.local.set({
      notes: (stored.notes || []).filter((n) => !sent.has(n.id)),
      pendingBatch: null,
    });
    pendingBatch = null;
    await loadNotes();
    await refresh();
    switchView("delivery");
  } catch (e) {
    tell("Delivery not confirmed. Your comments are saved. " + e.message);
  } finally {
    working = false;
    controls();
  }
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ["notes", "selected", "pendingBatch", "notice"].some((k) => k in changes))
    void loadNotes();
});

void loadNotes();
void refresh();
setInterval(refresh, 5000);

$("unlock").onclick = async () => {
  if (
    !confirm(
      "Check the batch in Deck first. Unlocking lets you create a new batch, which could duplicate a delivered request. Continue?",
    )
  )
    return;
  await chrome.storage.local.set({ pendingBatch: null });
  await loadNotes();
};

for (const view of ["comments", "delivery"])
  $(view + "-tab").onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "comments"
        : event.key === "End"
          ? "delivery"
          : view === "comments"
            ? "delivery"
            : "comments";
    switchView(next);
    $(next + "-tab").focus();
  };

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    if (!$("send").disabled) {
      e.preventDefault();
      $("send").click();
    }
  }
  if (e.key === "Escape") {
    const browseBtn = $("browse");
    if (browseBtn && browseBtn.getAttribute("aria-pressed") !== "true") {
      browseBtn.click();
    }
  }
});

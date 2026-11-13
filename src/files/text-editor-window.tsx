/* oxlint-disable react-hooks/exhaustive-deps -- Window lifecycle owns stable signals and Monaco resources. */
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { signal, useSignal, useSignalEffect } from "@preact/signals";
import {
  FilePlus,
  FolderOpen,
  FloppyDisk,
  MagnifyingGlass,
  TextAlignLeft,
  X,
  Plus,
  NotePencil,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { invoke, listen } from "../host/bridge";
import { ask } from "../host/dialog-host";
import { initSettings, settings } from "../settings/settings-store";
import { loadCustomThemes } from "../settings/custom-themes-store";
import { resolveTheme } from "../settings/themes";
import { applyThemeVars } from "../lib/theme-vars";
import { initializeDesktopEnvironmentFromBackend, hasPrimaryModifier } from "../lib/platform";
import { DeckIcon, CHROME_ICON } from "../ui/controls/deck-icon";
import {
  applyMonacoTheme,
  DECK_THEME_ID,
  languageForPath,
  loadMonaco,
  type MonacoApi,
} from "./editor-host";
import type { TextDocument, TextWorkspace } from "./text-editor-types";
import "../styles.css";
import "./text-editor.css";

const workspace = signal<TextWorkspace>({
  version: 1,
  active: null,
  documents: [],
  wrap: true,
  fontSize: 14,
});
const ready = signal(false);
const error = signal("");
const persistence = signal("Loading notes…");
let timer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let persisted = 0;
let pending: Promise<void> = Promise.resolve();
function report(reason: unknown) {
  error.value = reason instanceof Error ? reason.message : String(reason);
}
function flush(): Promise<void> {
  clearTimeout(timer);
  const version = revision;
  const snapshot = JSON.parse(JSON.stringify(workspace.value)) as TextWorkspace;
  const next = pending
    .catch(() => {})
    .then(async () => {
      if (version <= persisted) return;
      persistence.value = "Saving drafts…";
      await invoke("text_editor_persist", snapshot);
      persisted = version;
      if (revision === version) persistence.value = "Drafts saved on this device";
    });
  pending = next;
  return next.catch((reason: unknown) => {
    persistence.value = "Drafts could not be saved";
    report(reason);
    throw reason;
  });
}
function update(patch: Partial<TextWorkspace>) {
  workspace.value = { ...workspace.value, ...patch };
  revision += 1;
  persistence.value = "Draft changes pending…";
  clearTimeout(timer);
  timer = setTimeout(() => {
    void flush().catch(() => {});
  }, 400);
}
function patchDocument(id: string, patch: Partial<TextDocument>) {
  update({
    documents: workspace.value.documents.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)),
  });
}
function current() {
  return workspace.value.documents.find((doc) => doc.id === workspace.value.active);
}
function newNote() {
  if (workspace.value.documents.length >= 100) {
    report("Close a tab before adding more documents (100 tabs maximum).");
    return;
  }
  const doc: TextDocument = {
    id: crypto.randomUUID(),
    name: `Note ${workspace.value.documents.filter((d) => !d.path).length + 1}.txt`,
    path: null,
    content: "",
    savedContent: "",
    fingerprint: null,
  };
  update({ documents: [...workspace.value.documents, doc], active: doc.id });
}
async function openFiles(file?: string) {
  try {
    error.value = "";
    const files = await invoke<
      Array<{ path: string; name: string; content: string; fingerprint: string }>
    >("text_editor_read", file ? { file } : {});
    for (const value of files) {
      const existing = workspace.value.documents.find((doc) => doc.path === value.path);
      if (existing) {
        update({ active: existing.id });
        if (
          existing.content !== existing.savedContent &&
          !(await ask(
            "Replace your unsaved changes with the file on disk? Your current draft will be replaced.",
            { title: existing.name, kind: "warning", okLabel: "Reload file" },
          ))
        )
          continue;
        patchDocument(existing.id, { ...value, savedContent: value.content });
      } else {
        if (workspace.value.documents.length >= 100)
          throw new Error("Close a tab before opening more documents (100 tabs maximum).");
        const doc = { ...value, id: crypto.randomUUID(), savedContent: value.content };
        update({ documents: [...workspace.value.documents, doc], active: doc.id });
      }
    }
  } catch (reason) {
    report(reason);
  }
}
async function closeTab(doc: TextDocument) {
  const warning = doc.path ? doc.content !== doc.savedContent : doc.content.length > 0;
  if (
    warning &&
    !(await ask(
      doc.path ? "Discard changes to this file?" : "Delete this note and its saved draft?",
      { title: doc.name, kind: "warning", okLabel: doc.path ? "Discard changes" : "Delete note" },
    ))
  )
    return;
  const documents = workspace.value.documents.filter((value) => value.id !== doc.id);
  const index = workspace.value.documents.findIndex((value) => value.id === doc.id);
  update({
    documents,
    active:
      workspace.value.active === doc.id
        ? (documents[Math.min(index, documents.length - 1)]?.id ?? null)
        : workspace.value.active,
  });
}

function TextEditor() {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<{
    api: MonacoApi;
    editor: ReturnType<MonacoApi["editor"]["create"]>;
    models: Map<string, ReturnType<MonacoApi["editor"]["createModel"]>>;
    views: Map<string, ReturnType<ReturnType<MonacoApi["editor"]["create"]>["saveViewState"]>>;
    active: string | null;
    applying: boolean;
  } | null>(null);
  const editorReady = useSignal(false);
  const saving = useSignal(false);
  const position = useSignal("Ln 1, Col 1");
  const active = current();
  const save = async (saveAs = false) => {
    const doc = current();
    if (!doc || saving.value) return;
    saving.value = true;
    error.value = "";
    try {
      const result = await invoke<{ path: string; name: string; fingerprint: string } | null>(
        "text_editor_save",
        { ...doc, saveAs },
      );
      if (result) {
        const duplicate = workspace.value.documents.find(
          (other) => other.id !== doc.id && other.path === result.path,
        );
        // Keep each tab's draft independent; a duplicate will detect its stale disk fingerprint on save.
        patchDocument(doc.id, { ...result, savedContent: doc.content });
        if (duplicate)
          error.value = "This file is also open in another tab. Reopen that tab before saving it.";
        await flush();
      }
    } catch (reason) {
      report(reason);
    } finally {
      saving.value = false;
    }
  };
  const command = (id: string) => {
    void handle.current?.editor.getAction(id)?.run();
    handle.current?.editor.focus();
  };
  useSignalEffect(() => {
    applyThemeVars(document.documentElement.style, resolveTheme(settings.value));
    if (editorReady.value && handle.current) applyMonacoTheme(handle.current.api, settings.value);
  });
  useEffect(() => {
    let disposed = false;
    void loadMonaco()
      .then((api) => {
        if (disposed || !container.current) return;
        applyMonacoTheme(api, settings.value);
        const editor = api.editor.create(container.current, {
          theme: DECK_THEME_ID,
          automaticLayout: true,
          model: null,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 14,
          wordWrap: "on",
          lineNumbers: "on",
          renderWhitespace: "selection",
          padding: { top: 12 },
          accessibilitySupport: "auto",
        });
        const h = {
          api,
          editor,
          models: new Map(),
          views: new Map(),
          active: null as string | null,
          applying: false,
        };
        handle.current = h;
        editor.onDidChangeModelContent(() => {
          if (h.applying || !h.active) return;
          patchDocument(h.active, { content: editor.getModel()?.getValue(undefined, true) ?? "" });
        });
        editor.onDidChangeCursorPosition((event) => {
          position.value = `Ln ${event.position.lineNumber}, Col ${event.position.column}`;
        });
        editorReady.value = true;
      })
      .catch(report);
    return () => {
      disposed = true;
      const h = handle.current;
      h?.editor.dispose();
      h?.models.forEach((model) => model.dispose());
    };
  }, []);
  useSignalEffect(() => {
    if (!editorReady.value || !handle.current) return;
    const h = handle.current;
    const state = workspace.value;
    for (const [id, model] of h.models)
      if (!state.documents.some((doc) => doc.id === id)) {
        if (h.active === id) h.editor.setModel(null);
        model.dispose();
        h.models.delete(id);
        h.views.delete(id);
      }
    const doc = state.documents.find((value) => value.id === state.active);
    h.applying = true;
    try {
      if (doc) {
        let model = h.models.get(doc.id);
        if (!model) {
          model = h.api.editor.createModel(
            doc.content,
            languageForPath(doc.path ?? doc.name) ?? "plaintext",
          );
          h.models.set(doc.id, model);
        }
        if (h.active !== doc.id) {
          if (h.active) h.views.set(h.active, h.editor.saveViewState());
          h.editor.setModel(model);
          h.editor.restoreViewState(h.views.get(doc.id) ?? null);
          h.active = doc.id;
          h.editor.focus();
        }
        if (model.getValue(undefined, true) !== doc.content) model.setValue(doc.content);
        h.api.editor.setModelLanguage(model, languageForPath(doc.path ?? doc.name) ?? "plaintext");
      } else {
        h.editor.setModel(null);
        h.active = null;
      }
      h.editor.updateOptions({ wordWrap: state.wrap ? "on" : "off", fontSize: state.fontSize });
    } finally {
      h.applying = false;
    }
  });
  useEffect(() => {
    let closing = false;
    const close = () => {
      if (!ready.value) {
        void invoke("text_editor_close").catch(report);
        return;
      }
      if (closing) return;
      closing = true;
      void (async () => {
        try {
          await flush();
          const dirty = workspace.value.documents.filter(
            (doc) => doc.path && doc.content !== doc.savedContent,
          );
          if (
            dirty.length &&
            !(await ask(
              `${dirty.length} file(s) have unsaved changes. Drafts are saved on this device and will reopen next time. Close anyway?`,
              { title: "Unsaved files", kind: "warning", okLabel: "Keep drafts and close" },
            ))
          ) {
            await invoke("text_editor_cancel_close");
            return;
          }
          await flush();
          await invoke("text_editor_close");
        } catch (reason) {
          report(reason);
          await invoke("text_editor_cancel_close").catch(report);
        } finally {
          closing = false;
        }
      })();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!hasPrimaryModifier(event) || event.altKey || event.isComposing) return;
      const key = event.key.toLowerCase();
      if (!["n", "o", "s", "w", "=", "+", "-", "0"].includes(key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!ready.value) return;
      if (key === "n") newNote();
      if (key === "o") void openFiles();
      if (key === "s") void save(event.shiftKey);
      if (key === "w") {
        const doc = current();
        if (doc) void closeTab(doc);
      }
      if (key === "0") update({ fontSize: 14 });
      if (["=", "+", "-"].includes(key))
        update({
          fontSize: Math.max(10, Math.min(32, workspace.value.fontSize + (key === "-" ? -1 : 1))),
        });
    };
    let disposed = false;
    let stopClose: (() => void) | undefined;
    void listen("text-editor:close-requested", close)
      .then((stop) => {
        if (disposed) stop();
        else stopClose = stop;
      })
      .catch(report);
    window.addEventListener("keydown", keyboard, true);
    return () => {
      disposed = true;
      stopClose?.();
      window.removeEventListener("keydown", keyboard, true);
    };
  }, []);
  return (
    <main
      class="text-workbench"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!ready.value) return;
        const host = (
          globalThis as unknown as { __deckHost?: { getPathForFile(file: File): string } }
        ).__deckHost;
        void (async () => {
          for (const file of Array.from(event.dataTransfer?.files ?? [])) {
            const path = host?.getPathForFile(file);
            if (path) await openFiles(path);
          }
        })();
      }}
    >
      <header class="text-workbench__toolbar">
        <strong>Text Editor</strong>
        <button class="btn" disabled={!ready.value} onClick={newNote} title="New note (Ctrl+N)">
          <DeckIcon icon={FilePlus} size={CHROME_ICON} /> New note
        </button>
        <button
          class="btn"
          disabled={!ready.value}
          onClick={() => void openFiles()}
          title="Open files (Ctrl+O)"
        >
          <DeckIcon icon={FolderOpen} size={CHROME_ICON} /> Open
        </button>
        <span class="text-workbench__divider" />
        <button
          class="btn"
          disabled={!active || saving.value}
          onClick={() => void save()}
          title="Save (Ctrl+S)"
        >
          <DeckIcon icon={FloppyDisk} size={CHROME_ICON} /> {saving.value ? "Saving…" : "Save"}
        </button>
        <button
          class="btn"
          disabled={!active || saving.value}
          onClick={() => void save(true)}
          title="Save As (Ctrl+Shift+S)"
        >
          Save As
        </button>
        <span class="text-workbench__spacer" />
        <button
          class="btn"
          disabled={!active || !editorReady.value}
          onClick={() => command("actions.find")}
          title="Find (Ctrl+F)"
        >
          <DeckIcon icon={MagnifyingGlass} size={CHROME_ICON} /> Find
        </button>
        <button
          class="btn"
          disabled={!active || !editorReady.value}
          onClick={() => command("editor.action.startFindReplaceAction")}
        >
          Replace
        </button>
        <button
          class="btn"
          disabled={!ready.value}
          aria-pressed={workspace.value.wrap}
          onClick={() => update({ wrap: !workspace.value.wrap })}
          title="Toggle word wrap"
        >
          <DeckIcon icon={TextAlignLeft} size={CHROME_ICON} /> Wrap
        </button>
        <label class="text-workbench__zoom">
          Font size{" "}
          <select
            aria-label="Editor font size"
            value={workspace.value.fontSize}
            onChange={(event) => update({ fontSize: Number(event.currentTarget.value) })}
          >
            {Array.from({ length: 23 }, (_, i) => i + 10).map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error.value && (
        <div class="text-workbench__error" role="alert">
          <span>{error.value}</span>
          <button
            class="btn"
            onClick={() => {
              error.value = "";
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <div class="text-workbench__body">
        <aside class="text-workbench__notes" aria-label="Saved notes">
          <div class="text-workbench__notes-heading">
            <strong>Notes</strong>
            <button
              class="iconbtn"
              disabled={!ready.value}
              aria-label="Create note"
              onClick={newNote}
            >
              <DeckIcon icon={Plus} size={CHROME_ICON} />
            </button>
          </div>
          <p>Stored on this device</p>
          {workspace.value.documents
            .filter((doc) => !doc.path)
            .map((doc) => (
              <button
                key={doc.id}
                class={`text-workbench__note ${doc.id === workspace.value.active ? "is-active" : ""}`}
                aria-current={doc.id === workspace.value.active ? "true" : undefined}
                onClick={() => update({ active: doc.id })}
              >
                <DeckIcon icon={NotePencil} size={CHROME_ICON} />
                <span>
                  {doc.name}
                  <small>
                    {doc.content
                      .split(/\r?\n/)
                      .find((line) => line.trim())
                      ?.slice(0, 60) || "Empty note"}
                  </small>
                </span>
              </button>
            ))}
          {!workspace.value.documents.some((doc) => !doc.path) && (
            <p>Create a note to keep ideas and snippets here.</p>
          )}
        </aside>
        <section class="text-workbench__documents" aria-label="Documents">
          <div class="text-workbench__tabs" aria-label="Open documents">
            {workspace.value.documents.map((doc) => (
              <div
                key={doc.id}
                class={`text-workbench__tab ${doc.id === workspace.value.active ? "is-active" : ""}`}
              >
                <button
                  title={doc.path ?? "Local note"}
                  aria-pressed={doc.id === workspace.value.active}
                  onClick={() => update({ active: doc.id })}
                >
                  {doc.name}
                  {doc.path && doc.content !== doc.savedContent && (
                    <span aria-label="Unsaved changes"> *</span>
                  )}
                </button>
                <button aria-label={`Close ${doc.name}`} onClick={() => void closeTab(doc)}>
                  <DeckIcon icon={X} size={CHROME_ICON} />
                </button>
              </div>
            ))}
          </div>
          {active && (
            <div class="text-workbench__location">
              {active.path ? (
                <span title={active.path}>{active.path}</span>
              ) : (
                <label>
                  Note name{" "}
                  <input
                    aria-label="Note name"
                    value={active.name}
                    maxLength={120}
                    onInput={(event) =>
                      patchDocument(active.id, { name: event.currentTarget.value })
                    }
                  />
                </label>
              )}
              {active.path && (
                <button
                  class="btn"
                  title="Reload from disk"
                  disabled={saving.value}
                  onClick={() => void openFiles(active.path!)}
                >
                  <DeckIcon icon={ArrowCounterClockwise} size={CHROME_ICON} /> Reload
                </button>
              )}
            </div>
          )}
          <div class="text-workbench__editor-wrap">
            <div
              class="text-workbench__editor"
              ref={container}
              style={{ visibility: active ? "visible" : "hidden" }}
            />
            {!active && (
              <div class="text-workbench__empty">
                <DeckIcon icon={NotePencil} size={CHROME_ICON} />
                <h1>A place for your text</h1>
                <p>
                  Open a file, drop one here, or start a note.
                  <br />
                  Your notes and open drafts return when you reopen this window.
                </p>
                <div>
                  <button class="btn" disabled={!ready.value} onClick={newNote}>
                    New note
                  </button>
                  <button class="btn" disabled={!ready.value} onClick={() => void openFiles()}>
                    Open file
                  </button>
                </div>
              </div>
            )}
            {active && !editorReady.value && (
              <p class="text-workbench__loading" role="status">
                Loading editor…
              </p>
            )}
          </div>
        </section>
      </div>
      <footer class="text-workbench__status" role="status">
        <span>{persistence.value}</span>
        <span>
          {active
            ? `${position.value} · ${active.content.length.toLocaleString()} characters · UTF-8${active.content.includes("\r\n") ? " · CRLF" : " · LF"}`
            : "UTF-8 text · Up to 8 MB per file"}
        </span>
      </footer>
    </main>
  );
}

async function main() {
  render(<TextEditor />, document.getElementById("root")!);
  try {
    await initializeDesktopEnvironmentFromBackend();
    await initSettings();
    await loadCustomThemes();
    workspace.value = await invoke<TextWorkspace>("text_editor_restore");
    ready.value = true;
    persistence.value = "Drafts saved on this device";
  } catch (reason) {
    persistence.value = "Workspace unavailable";
    report(reason);
  }
}
void main();

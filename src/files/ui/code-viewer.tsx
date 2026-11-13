import { useEffect, useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Code, FolderOpen, MagnifyingGlass, X } from "@phosphor-icons/react";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import { open as openDialog } from "../../host/dialog-host";
import { baseName } from "../../lib/path-name";
import { Modal } from "../../ui/modal";
import { getDesktopEnvironment, hasPrimaryModifier } from "../../lib/platform";
import type { FileSurfaceController } from "../file-surface-controller";
import {
  activeFileTab,
  documentFor,
  pendingReveal,
  setActiveWorkspace,
  surfaceFor,
} from "../file-surface-store";
import { defaultFileClient } from "../file-client";
import { codeViewerRoot } from "../code-viewer-store";
import {
  codePathLabel,
  matchCodeFiles,
  scanCodeFiles,
  type CodeFileIndex,
} from "../code-file-search";
import { FileTreeView } from "./file-tree-view";
import { FileEditor, type FileEditorProps } from "./file-editor";
import { CodeSourceControl } from "../review/code-source-control";
import "./code-viewer.css";

export function CodeViewer({
  controller,
  root,
  onClose,
  closeLabel = "Back to terminals",
  onOpenFolder,
}: {
  controller: FileSurfaceController;
  root: string;
  onClose(): void;
  closeLabel?: string;
  onOpenFolder?(root: string): Promise<void>;
}) {
  const host = useRef<HTMLElement>(null);
  const search = useSignal(false);
  const view = useSignal<"files" | "source-control">("files");
  useSignalEffect(() => {
    if (pendingReveal.value !== null) view.value = "files";
  });
  const error = useSignal("");
  const choosing = useSignal(false);
  const command = useSignal<FileEditorProps["command"]>(undefined);
  const surface = surfaceFor(root);
  const path = surface.activePath;
  const file = documentFor(path);
  const mod = getDesktopEnvironment().platform === "macos" ? "⌘" : "Ctrl+";

  useEffect(() => {
    setActiveWorkspace(root);
    host.current?.focus();
    return () => controller.deactivate();
  }, [controller, root]);

  const run = (id: NonNullable<FileEditorProps["command"]>["id"]) => {
    command.value = { id, nonce: (command.value?.nonce ?? 0) + 1 };
  };
  const chooseFolder = async () => {
    if (choosing.value) return;
    choosing.value = true;
    error.value = "";
    try {
      const next = await openDialog({ directory: true, title: "Choose a folder to view code" });
      if (next !== null) {
        if (onOpenFolder) await onOpenFolder(next);
        else codeViewerRoot.value = next;
      }
    } catch {
      error.value = "Couldn't open the folder picker. Try again.";
    } finally {
      choosing.value = false;
    }
  };

  return (
    <section class="stage__surface code-viewer-surface" aria-label="Code viewer">
      <section
        class="code-viewer"
        ref={host}
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          if (event.isComposing || search.value) return;
          if (view.value !== "files") return;
          const modifier = hasPrimaryModifier(event);
          const key = event.key.toLowerCase();
          if (
            modifier &&
            !event.altKey &&
            !event.shiftKey &&
            ["p", "f", "g", "w", "s"].includes(key)
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (key === "p") search.value = true;
            if (path !== null && key === "f") run("actions.find");
            if (path !== null && key === "g") run("editor.action.gotoLine");
            if (path !== null && key === "w") void controller.closePath(root, path);
          }
        }}
      >
        <header class="code-viewer__header">
          <DeckIcon icon={Code} size={CHROME_ICON} />
          <strong>Code</strong>
          <span class="code-viewer__root" title={root}>
            {root}
          </span>
          <span class="code-viewer__readonly">Read only</span>
          <button
            type="button"
            class="btn"
            disabled={choosing.value}
            onClick={() => void chooseFolder()}
          >
            <DeckIcon icon={FolderOpen} size={CHROME_ICON} /> Open folder
          </button>
          <button type="button" class="btn" onClick={onClose}>
            {closeLabel}
          </button>
        </header>
        <div
          class="code-viewer__modes"
          role="tablist"
          aria-label="Code view"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "files"
                : event.key === "End"
                  ? "source-control"
                  : view.value === "files"
                    ? "source-control"
                    : "files";
            search.value = false;
            view.value = next;
            event.currentTarget
              .querySelector<HTMLButtonElement>(`[data-code-view="${next}"]`)
              ?.focus();
          }}
        >
          {(
            [
              ["files", "Files"],
              ["source-control", "Source control"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              role="tab"
              key={id}
              data-code-view={id}
              aria-selected={view.value === id}
              tabIndex={view.value === id ? 0 : -1}
              onClick={() => {
                search.value = false;
                view.value = id;
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {error.value && (
          <p class="code-viewer__error" role="alert">
            {error.value}
          </p>
        )}
        {view.value === "source-control" ? (
          <CodeSourceControl key={root} root={root} />
        ) : (
          <div class="code-viewer__body">
            <aside class="code-viewer__tree" aria-label="Source files">
              <button
                type="button"
                class="code-viewer__search"
                onClick={() => {
                  search.value = true;
                }}
              >
                <DeckIcon icon={MagnifyingGlass} size={CHROME_ICON} />
                Find file <kbd>{mod}P</kbd>
              </button>
              <FileTreeView controller={controller} workspacePath={root} canCreate={false} />
            </aside>
            <div class="code-viewer__document">
              {surface.tabs.length > 0 && (
                <div class="code-viewer__tabs" role="tablist" aria-label="Open code files">
                  {surface.tabs.map((tab) => (
                    <div class="code-viewer__tab" key={tab.path}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab.path === path}
                        class={tab.path === path ? "is-active" : ""}
                        title={tab.path}
                        onClick={() => controller.activateFile(root, tab.path, false)}
                      >
                        {baseName(tab.path)}
                      </button>
                      <button
                        type="button"
                        aria-label={`Close ${baseName(tab.path)}`}
                        onClick={() => void controller.closePath(root, tab.path)}
                      >
                        <DeckIcon icon={X} size={CHROME_ICON} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {path === null ? (
                <div class="code-viewer__empty">
                  <h2>Open a file to read its source</h2>
                  <p>Choose a file in the tree, or find it by name.</p>
                  <button
                    type="button"
                    class="btn"
                    onClick={() => {
                      search.value = true;
                    }}
                  >
                    Find file · {mod}P
                  </button>
                </div>
              ) : (
                <>
                  <div class="code-viewer__filebar">
                    <span title={path}>{codePathLabel(root, path)}</span>
                    <button type="button" class="btn" onClick={() => run("actions.find")}>
                      Find · {mod}F
                    </button>
                    <button type="button" class="btn" onClick={() => run("editor.action.gotoLine")}>
                      Go to line · {mod}G
                    </button>
                  </div>
                  <div
                    class="code-viewer__editor"
                    onFocusIn={() => {
                      activeFileTab.value = path;
                    }}
                  >
                    <FileEditor
                      path={path}
                      controller={controller}
                      readOnly
                      command={command.value}
                    />
                  </div>
                  <footer class="code-viewer__status" role="status">
                    {file?.file === null && file.refusal === null
                      ? "Loading file…"
                      : `Ln ${file?.line ?? 1}, Col ${file?.column ?? 1}`}
                    <span>Read only · Select and copy code</span>
                  </footer>
                </>
              )}
            </div>
          </div>
        )}
      </section>
      {search.value && (
        <CodeFilePicker
          root={root}
          onClose={() => {
            search.value = false;
          }}
          onOpen={(next) => {
            void controller.openFile(root, next, true);
            search.value = false;
          }}
        />
      )}
    </section>
  );
}

function CodeFilePicker({
  root,
  onClose,
  onOpen,
}: {
  root: string;
  onClose(): void;
  onOpen(path: string): void;
}) {
  const query = useSignal("");
  const index = useSignal<CodeFileIndex>({ paths: [], limited: false, unreadable: 0 });
  const scanning = useSignal(true);
  const selected = useSignal(0);
  const results = useRef<HTMLDivElement>(null);
  const showHidden = surfaceFor(root).showHidden;
  /* oxlint-disable react-hooks/exhaustive-deps -- Signals are stable scan outputs. */
  useEffect(() => {
    const abort = new AbortController();
    scanning.value = true;
    void scanCodeFiles(root, defaultFileClient, abort.signal, showHidden, (next) => {
      index.value = next;
    }).finally(() => {
      if (!abort.signal.aborted) scanning.value = false;
    });
    return () => abort.abort();
  }, [root, showHidden]);
  /* oxlint-enable react-hooks/exhaustive-deps */
  const matches = matchCodeFiles(root, index.value.paths, query.value);
  const current = Math.min(selected.value, Math.max(0, matches.length - 1));
  useEffect(() => {
    results.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <Modal
      panelClass="code-file-picker"
      label="Find code file"
      initialFocus="input"
      onDismiss={onClose}
      onKeyDown={(event) => {
        if (event.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          selected.value = Math.max(
            0,
            Math.min(matches.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)),
          );
        }
        if (event.key === "Enter" && matches[current]) {
          event.preventDefault();
          onOpen(matches[current]);
        }
      }}
    >
      <label class="code-file-picker__label" for="code-file-query">
        Find file
      </label>
      <input
        id="code-file-query"
        value={query.value}
        placeholder="Type a file name or path…"
        autoComplete="off"
        role="combobox"
        aria-expanded="true"
        aria-controls="code-file-results"
        aria-autocomplete="list"
        aria-activedescendant={matches[current] ? `code-file-${current}` : undefined}
        onInput={(event) => {
          query.value = event.currentTarget.value;
          selected.value = 0;
        }}
      />
      <div
        ref={results}
        class="code-file-picker__results"
        id="code-file-results"
        role="listbox"
        aria-label="Matching files"
      >
        {matches.map((path, i) => (
          <button
            type="button"
            role="option"
            id={`code-file-${i}`}
            key={path}
            tabIndex={-1}
            aria-selected={i === current}
            title={path}
            onClick={() => onOpen(path)}
          >
            <strong>{baseName(path)}</strong>
            <span>{codePathLabel(root, path)}</span>
          </button>
        ))}
        {matches.length === 0 && (
          <p role="status">
            {scanning.value
              ? "Looking for files…"
              : "No matching files. Try another name or browse the tree."}
          </p>
        )}
      </div>
      <p class="code-file-picker__hint" role="status">
        {scanning.value ? "Looking for files…" : `${index.value.paths.length} files`}
        {index.value.limited ? " · Search limit reached; use the tree for other files." : ""}
        {index.value.unreadable > 0 ? " · Some folders could not be read." : ""}
        <span>↑ ↓ to select · Enter to open · Esc to cancel</span>
      </p>
    </Modal>
  );
}

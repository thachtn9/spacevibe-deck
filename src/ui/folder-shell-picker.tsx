import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { invoke } from "../host/bridge";
import { open as openDialog } from "../host/dialog-host";
import { Modal } from "./modal";
import "./folder-shell-picker.css";

type Directory = { path: string; name: string; directory: boolean; outOfRoot: boolean };

export function FolderShellPicker({
  root,
  onOpen,
  onClose,
}: {
  root: string;
  onOpen(path: string): Promise<boolean>;
  onClose(): void;
}) {
  const paths = useSignal<string[]>([root]);
  const query = useSignal("");
  const selected = useSignal(0);
  const scanning = useSignal(true);
  const busy = useSignal(false);
  const error = useSignal("");
  /* oxlint-disable react-hooks/exhaustive-deps -- Stable signals are written by this scan, never dependencies. */
  useEffect(() => {
    let cancelled = false;
    const scan = async () => {
      const queue = [root];
      const seen = new Set([root]);
      let visited = 0;
      while (queue.length && !cancelled && visited++ < 300 && seen.size < 3000) {
        const directory = queue.shift()!;
        try {
          const rows = await invoke<Directory[]>("list_dir", { root, directory });
          for (const row of rows) {
            if (
              !row.directory ||
              row.outOfRoot ||
              seen.has(row.path) ||
              [".git", "node_modules", ".cache"].includes(row.name)
            )
              continue;
            seen.add(row.path);
            queue.push(row.path);
          }
          if (!cancelled) paths.value = [...seen];
        } catch {
          if (directory === root && !cancelled)
            error.value = "Couldn't read this folder. Use Browse to choose another.";
        }
      }
      if (!cancelled) scanning.value = false;
    };
    void scan();
    return () => {
      cancelled = true;
    };
  }, [root]);
  /* oxlint-enable react-hooks/exhaustive-deps */
  const matches = paths.value
    .filter((path) => {
      const text = path.toLowerCase();
      let at = 0;
      for (const char of query.value.toLowerCase()) {
        at = text.indexOf(char, at);
        if (at < 0) return false;
        at++;
      }
      return true;
    })
    .slice(0, 100);
  const choose = async (path: string) => {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      if (await onOpen(path)) onClose();
      else error.value = "Couldn't open the shell. Try again.";
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Couldn't open the shell.";
    } finally {
      busy.value = false;
    }
  };
  return (
    <Modal
      panelClass="folder-shell-picker"
      label="Open shell in folder"
      initialFocus="input"
      onDismiss={() => {
        if (!busy.value) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          selected.value = Math.max(
            0,
            Math.min(matches.length - 1, selected.value + (event.key === "ArrowDown" ? 1 : -1)),
          );
          document
            .getElementById(`folder-result-${selected.value}`)
            ?.scrollIntoView({ block: "nearest" });
        } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          if (matches[selected.value]) void choose(matches[selected.value]);
        }
        event.stopPropagation();
      }}
    >
      <h2>Open shell in folder</h2>
      <input
        aria-label="Find folder"
        placeholder="Type to find a folder…"
        value={query.value}
        disabled={busy.value}
        onInput={(event) => {
          query.value = event.currentTarget.value;
          selected.value = 0;
        }}
      />
      <p class="folder-shell-picker__root" title={root}>
        {root}
      </p>
      <div class="folder-shell-picker__results" role="listbox" aria-label="Folders">
        {matches.map((path, index) => (
          <button
            key={path}
            id={`folder-result-${index}`}
            type="button"
            role="option"
            aria-selected={index === selected.value}
            disabled={busy.value}
            title={path}
            onClick={() => void choose(path)}
          >
            {path}
          </button>
        ))}
        {!matches.length && <p>No matching folders. Use Browse to choose another folder.</p>}
      </div>
      {error.value && <p role="alert">{error.value}</p>}
      <footer>
        <span>
          {busy.value
            ? "Opening…"
            : scanning.value
              ? "Finding folders…"
              : "↑ ↓ to select · Enter to open · Esc to cancel"}
        </span>
        <button
          type="button"
          class="btn"
          disabled={busy.value}
          onClick={() => {
            void openDialog({ directory: true, multiple: false })
              .then((path) => {
                if (typeof path === "string") return choose(path);
              })
              .catch(() => {
                error.value = "Couldn't open the folder browser.";
              });
          }}
        >
          Browse…
        </button>
      </footer>
    </Modal>
  );
}

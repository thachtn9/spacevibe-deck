import { useState } from "preact/hooks";
import { invoke } from "../host/bridge";
import { message } from "../host/dialog-host";

export function TextEditorButton() {
  const [opening, setOpening] = useState(false);
  const available = typeof (globalThis as { __deckHost?: unknown }).__deckHost !== "undefined";
  return (
    <button
      type="button"
      class="btn"
      aria-label="Text Editor"
      title={available ? "Open Text Editor and notes" : "Text Editor requires Electron"}
      disabled={opening || !available}
      onClick={async () => {
        setOpening(true);
        try {
          await invoke("text_editor_open");
        } catch (error) {
          await message(String(error), { title: "Couldn't open Text Editor", kind: "error" });
        } finally {
          setOpening(false);
        }
      }}
    >
      Text Editor
    </button>
  );
}

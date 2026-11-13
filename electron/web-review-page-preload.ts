import { ipcRenderer } from "electron";

// This preload exposes no host API to the localhost app.
declare const window: {
  addEventListener(
    type: string,
    listener: (event: { isTrusted?: boolean; detail?: unknown }) => void,
    capture?: boolean,
  ): void;
};
let gestureAt = 0;
for (const type of ["pointerdown", "pointerup", "keydown"])
  window.addEventListener(
    type,
    (event) => {
      if (event.isTrusted) gestureAt = Date.now();
    },
    true,
  );
window.addEventListener("deck:web-review-capture", (event) => {
  if (
    Date.now() - gestureAt > 2500 ||
    typeof event.detail !== "string" ||
    event.detail.length > 24_000
  )
    return;
  ipcRenderer.send("web-review:capture", event.detail);
});
window.addEventListener("deck:web-review-cancel", () => {
  if (Date.now() - gestureAt < 2500) ipcRenderer.send("web-review:cancel");
});

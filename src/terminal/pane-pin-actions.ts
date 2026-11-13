/** Window-scoped action seam for headers rendered outside App's Preact tree. */
let toggle: (id: number) => void = () => {};

export function togglePanePin(id: number): void {
  toggle(id);
}

export function registerPanePinAction(action: (id: number) => void): () => void {
  toggle = action;
  return () => {
    if (toggle === action) toggle = () => {};
  };
}

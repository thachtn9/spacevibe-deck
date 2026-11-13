import { signal } from "@preact/signals";

/** Codex publishes its current conversation name in this pane's OSC window title. */
export function codexSessionTitle(value: string): string | null {
  const clean = value.replace(/^[\u2800-\u28ff]\s*/, "").trim();
  const separator = clean.lastIndexOf(" | ");
  if (separator < 1) return null;
  const title = clean.slice(0, separator).trim();
  if (!title || /^(?:codex|codex cli|openai codex)$/i.test(title)) return null;
  return title.slice(0, 240);
}

/** Display text only; a terminal title never supplies a resume/session identity. */
export const paneSessionTitles = signal<ReadonlyMap<number, string>>(new Map());

export function notePaneSessionTitle(id: number, value: string): void {
  const title = codexSessionTitle(value);
  if (title === null) {
    forgetPaneSessionTitle(id);
    return;
  }
  if (paneSessionTitles.peek().get(id) === title) return;
  paneSessionTitles.value = new Map(paneSessionTitles.peek()).set(id, title);
}

export function forgetPaneSessionTitle(id: number): void {
  if (!paneSessionTitles.peek().has(id)) return;
  const next = new Map(paneSessionTitles.peek());
  next.delete(id);
  paneSessionTitles.value = next;
}

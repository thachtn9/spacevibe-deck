const SYNC_START = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";
const FULL_CLEAR = "\x1b[2J\x1b[3J\x1b[H";
const MAX_WAIT_MS = 250;
const MAX_BUFFER_CHARS = 256 * 1024;

/**
 * AGY first erases its response on SIGWINCH, then sends a full repaint about
 * 150ms later. Keep the reflowed content visible until that repaint is complete.
 * The timeout and size cap preserve output when a CLI exits or changes protocol.
 */
export function createAgyResizeRepaint(emit: (data: string) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let buffered = "";

  function flush(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const data = buffered;
    buffered = "";
    if (data) emit(data);
  }

  return {
    begin(): void {
      // Keep the original deadline during continuous resizing.
      if (timer === null) timer = setTimeout(flush, MAX_WAIT_MS);
    },
    write(data: string): void {
      if (timer === null) {
        emit(data);
        return;
      }
      buffered += data;
      const clear = buffered.indexOf(FULL_CLEAR);
      const start = clear < 0 ? -1 : buffered.indexOf(SYNC_START, clear + FULL_CLEAR.length);
      if (
        (start >= 0 && buffered.indexOf(SYNC_END, start + SYNC_START.length) >= 0) ||
        buffered.length >= MAX_BUFFER_CHARS
      ) {
        flush();
      }
    },
    flush,
    dispose(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      buffered = "";
    },
  };
}

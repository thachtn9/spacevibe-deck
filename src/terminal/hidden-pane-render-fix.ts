import type { Terminal } from "@xterm/xterm";

/**
 * Workaround for an xterm.js render-pause gap that saturates the renderer
 * while a hidden tab prints.
 *
 * `RenderService.refreshRows` skips rendering while the terminal is paused —
 * its IntersectionObserver reports the screen element off screen, which is
 * every pane of a `display: none` tab — but `handleSelectionChanged` forwards
 * to the renderer regardless. The selection service calls it on every scroll,
 * so a hidden pane with scrolling output redraws all of its rows each frame.
 * Hidden panes run the DOM renderer (WebGL is released on hide, see
 * `suspendRenderer` in pane.ts), and its width cache measures glyphs through
 * `offsetWidth`, which is 0 inside `display: none` and therefore never cached.
 * Measured 2026-10-05 on 6.0.0: one hidden scrolling pane held the renderer
 * near 100% of a core; fifteen froze the window for seconds at a time.
 * xterm.js `master` still has the same `handleSelectionChanged`; reported as
 * xtermjs/xterm.js#6208 — remove this module once a release carries a fix.
 *
 * Tab switches also deliver blur and already queued render frames before the
 * IntersectionObserver sees display:none. Guard those paths against the inline
 * hidden ancestors too; otherwise every uncached glyph forces another layout.
 *
 * While paused, the wrapper records the selection and sets the two flags xterm
 * already uses to repaint on resume: `_needsFullRefresh` makes the resume
 * refresh every row, and `_needsSelectionRefresh` makes that render re-apply
 * the recorded selection. A visible terminal takes the original path.
 */

type SelectionPoint = [number, number] | undefined;

interface SelectionState {
  start: SelectionPoint;
  end: SelectionPoint;
  columnSelectMode: boolean;
}

interface RendererInternals {
  renderRows(start: number, end: number): void;
}

interface RenderServiceInternals {
  _renderer: { value?: RendererInternals };
  setRenderer(renderer: RendererInternals): void;
  _isPaused: boolean;
  _needsFullRefresh: boolean;
  _needsSelectionRefresh: boolean;
  _selectionState: SelectionState;
  _renderRows(start: number, end: number): void;
  handleBlur(): void;
  handleFocus(): void;
  handleSelectionChanged(
    start: SelectionPoint,
    end: SelectionPoint,
    columnSelectMode: boolean,
  ): void;
}

function getRenderService(term: Terminal): RenderServiceInternals | null {
  const service = (
    term as unknown as { _core?: { _renderService?: Partial<RenderServiceInternals> } }
  )._core?._renderService;
  if (
    !service ||
    typeof service.handleSelectionChanged !== "function" ||
    typeof service._renderRows !== "function" ||
    typeof service.setRenderer !== "function" ||
    typeof service._renderer !== "object" ||
    service._renderer === null ||
    typeof service.handleBlur !== "function" ||
    typeof service.handleFocus !== "function" ||
    typeof service._isPaused !== "boolean" ||
    typeof service._needsFullRefresh !== "boolean" ||
    typeof service._needsSelectionRefresh !== "boolean" ||
    typeof service._selectionState !== "object" ||
    service._selectionState === null
  ) {
    return null;
  }
  return service as RenderServiceInternals;
}

/**
 * Gate selection repaints on the render pause. Call after `term.open()`, which
 * creates the render service. Returns false, leaving xterm untouched, when its
 * internals no longer have the expected shape — the test that opens a real
 * terminal fails in that case, so an xterm upgrade cannot drop it silently.
 */
export function applyHiddenPaneRenderFix(term: Terminal): boolean {
  const service = getRenderService(term);
  if (service === null) {
    return false;
  }
  const hidden = (): boolean => {
    if (service._isPaused) return true;
    // Read only inline visibility written by the tab manager: no forced layout.
    for (let element = term.element; element; element = element.parentElement ?? undefined) {
      if (element.style.display === "none") return true;
    }
    return false;
  };
  const defer = (): void => {
    service._needsSelectionRefresh = true;
    service._needsFullRefresh = true;
  };
  // The DOM fallback's resize path calls its own renderRows directly, bypassing
  // RenderService. Wrap each replacement before WebGL disposal resizes it.
  const wrapped = new WeakSet<RendererInternals>();
  const guardRenderer = (renderer: RendererInternals): void => {
    if (wrapped.has(renderer)) return;
    wrapped.add(renderer);
    const render = renderer.renderRows.bind(renderer);
    renderer.renderRows = (start, end) => {
      if (hidden()) defer();
      else render(start, end);
    };
  };
  if (service._renderer.value) guardRenderer(service._renderer.value);
  const setRenderer = service.setRenderer.bind(service);
  service.setRenderer = (renderer) => {
    guardRenderer(renderer);
    setRenderer(renderer);
  };
  const renderRows = service._renderRows.bind(service);
  service._renderRows = (start, end) => {
    if (hidden()) defer();
    else renderRows(start, end);
  };
  for (const method of ["handleBlur", "handleFocus"] as const) {
    const original = service[method].bind(service);
    service[method] = () => {
      if (hidden()) defer();
      else original();
    };
  }
  const original = service.handleSelectionChanged.bind(service);
  service.handleSelectionChanged = (start, end, columnSelectMode) => {
    if (!hidden()) {
      original(start, end, columnSelectMode);
      return;
    }
    service._selectionState = { start, end, columnSelectMode };
    service._needsSelectionRefresh = true;
    service._needsFullRefresh = true;
  };
  return true;
}

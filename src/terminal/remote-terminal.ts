import type { RemoteTerminalFrame, RemoteTerminalRequest } from "../lib/deck-remote";

const panes = new Map<number, ReturnType<typeof createRemoteTerminal>>();
const LIMIT = 262_144;
const LEASE_MS = 12_000;

/** Window-local adapter: only the owning renderer can reach a registered pane. */
export function remoteTerminalFor(id: number) {
  const pane = panes.get(id);
  if (!pane) throw new Error("This terminal is no longer available.");
  return pane;
}

export function createRemoteTerminal(deps: {
  id: number;
  flush: () => Promise<void>;
  snapshot: () => string;
  dimensions: () => { cols: number; rows: number };
  resize: (cols: number, rows: number) => void;
  restore: () => void;
  write: (data: string) => Promise<boolean>;
  controlled: (active: boolean) => void;
}) {
  let observed = false;
  let sequence = 0;
  let size = 0;
  let chunks: { cursor: number; data: string }[] = [];
  let geometry = "";
  let owner: string | null = null;
  let identity = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let flight: Promise<unknown> = Promise.resolve();
  const release = () => {
    const hadOwner = owner !== null;
    clearTimeout(timer);
    owner = null;
    deps.controlled(false);
    if (!disposed && hadOwner) deps.restore();
  };
  const renew = () => {
    clearTimeout(timer);
    timer = setTimeout(release, LEASE_MS);
  };
  const adapter = {
    reclaim: release,
    get controlled() {
      return owner !== null;
    },
    output(data: string) {
      if (!data || !observed) return;
      chunks.push({ cursor: ++sequence, data });
      size += data.length;
      while (size > LIMIT && chunks.length) size -= chunks.shift()!.data.length;
    },
    request(request: RemoteTerminalRequest, valid: () => boolean): Promise<RemoteTerminalFrame> {
      const run = async () => {
        if (disposed || !valid()) throw new Error("This session changed. Reopen the terminal.");
        observed = true;
        if (identity !== request.generation) {
          release();
          identity = request.generation;
        }
        if (request.action === "claim") {
          if (owner && owner !== request.client)
            throw new Error("Another browser controls this terminal.");
          const { cols, rows } = request;
          if (
            !Number.isInteger(cols) ||
            !Number.isInteger(rows) ||
            cols! < 24 ||
            cols! > 500 ||
            rows! < 2 ||
            rows! > 200
          )
            throw new Error("Invalid terminal dimensions.");
          await deps.flush();
          if (disposed || !valid()) throw new Error("This session changed.");
          owner = request.client;
          renew();
          deps.controlled(true);
          deps.resize(cols!, rows!);
        } else if (request.action === "release") {
          if (owner === request.client) release();
        } else if (request.action === "write") {
          if (owner !== request.client) throw new Error("Take control before typing.");
          if (
            typeof request.data !== "string" ||
            new TextEncoder().encode(request.data).length > 32768
          )
            throw new Error("Input exceeds 32 KB.");
          renew();
          if (!(await deps.write(request.data)))
            throw new Error("Input could not reach the terminal. Reconnect before typing.");
        } else if (owner === request.client) renew();
        await deps.flush();
        if (disposed || !valid()) throw new Error("This session changed.");
        const dimensions = deps.dimensions();
        const nextGeometry = `${dimensions.cols}:${dimensions.rows}`;
        if (nextGeometry !== geometry) {
          geometry = nextGeometry;
          sequence++;
          chunks = [];
          size = 0;
        }
        const cursor = request.cursor;
        const first = chunks[0]?.cursor ?? sequence + 1;
        const reset = cursor === undefined || cursor < first - 1 || cursor > sequence;
        return {
          ...dimensions,
          cursor: sequence,
          reset,
          controller: owner,
          data:
            request.action !== "read"
              ? ""
              : reset
                ? deps.snapshot()
                : chunks
                    .filter((chunk) => chunk.cursor > cursor)
                    .map((chunk) => chunk.data)
                    .join(""),
        };
      };
      const result = flight.then(run);
      flight = result.catch(() => {});
      return result;
    },
    dispose() {
      disposed = true;
      release();
      chunks = [];
      if (panes.get(deps.id) === adapter) panes.delete(deps.id);
    },
  };
  panes.set(deps.id, adapter);
  return adapter;
}

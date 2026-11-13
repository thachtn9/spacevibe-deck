# Deck Remote

> For maintainers. Deck Remote provides a mobile web client and an optional native iOS client for the Electron host.

The computer remains the execution host. The web workspace groups sessions by folder,
opens shell or agent tabs with their own working directories, creates folders beneath the
shared root and displays up to two interactive xterm terminals. Web input uses terminal
key sequences, including interrupts, completion, navigation and bracketed paste. The optional
native iOS client retains the bounded resolved-cell screen and explicit Send protocol.
On Linux, both clients use an independent remote workspace. Desktop tabs are never
published into that workspace, and remote session creation never materializes desktop tabs.
Other Electron platforms retain the renderer-backed compatibility path.

## Independent Linux workspace

The gateway owns a dedicated persistent terminal service under
`userData/remote-workspace`, with a separate socket identity from the desktop service.
`workspace.json` records remote session IDs and exact daemon-epoch/PTY references. Reopening the browser or restarting the GUI reattaches those exact live
references without spawning replacements. A dead service leaves ended sessions; it never
resumes a guessed conversation. An unreadable registry blocks creation instead of replacing
state. Live service references recover a shell orphaned by a GUI crash during creation.

The desktop coordinator, journals, selection, fitting and close census never receive remote
PTYs. The remote service parses output and answers terminal protocol queries; the browser
forwards user input only. Each remote shell has its own cwd and process environment, while
files and installed tools remain on the same computer. Browser-local preferences preserve
the selected session, split view, collapsed groups and remembered folders independently of
the desktop workspace. Explicit session close kills only that remote PTY and removes its row.
Closing a browser only releases its input lease. Deck must be open for gateway access,
although the detached remote terminals survive GUI shutdown.

The web terminal receives authenticated, same-origin NDJSON output streams. A bounded ANSI
ring supplies incremental frames; an old cursor or geometry change requires a sequence-bound
snapshot with explicit mouse encoding. The service drains its parser before snapshots and
resizes. The browser uses the desktop WebGL glyph renderer for combining-mark clusters;
unsupported or lost GPU contexts fall back to xterm DOM without replacing the terminal buffer.
Packaged xterm, Fit, Unicode Graphemes and WebGL distributions are copied from installed
dependencies by both Electron build paths. Scripts remain external and same-origin; CSS
permits xterm's generated styles. No terminal content is interpreted as HTML.

Opening a web terminal automatically acquires a 12-second renewable geometry/input lease;
there are no manual control buttons. Leases arbitrate between browsers only on Linux,
without affecting desktop terminal sizes or input. Background browser views release their
leases; a lost network expires without replaying input. Normal-buffer wheel and single-finger
gestures scroll local history even when a CLI enables mouse tracking. Alternate-screen wheel
events remain with the application, and touch gestures translate to its wheel protocol.
Keep the outer terminal body from scrolling vertically: xterm owns the history viewport.

Raw keyboard mutations use a separate private `remote-terminal-actions.json` high-water ledger.
Each timestamped connection has monotonically increasing action numbers, reserved on disk
before input or resize. Repeated or out-of-order actions are rejected, including after restart;
clients reconnect with a new connection identity and never replay uncertain input. This keeps
storage bounded by connections rather than keystrokes. Folder/session creation and session
close use the timestamped idempotency reservations.

The compatibility path on other platforms delegates to the existing owning renderer, never
attaching a second owner to a desktop PTY. Its generation checks and renewable input/geometry
lease remain in force; local Return here restores desktop fitting.

## Pairing and reconnect

Remote access starts disabled. The desktop settings enable an IPv4 listener and copy a
connection containing an address and a random bearer key. Use a trusted LAN or an encrypted
private network such as Tailscale. The gateway does not supply public TLS termination.
The native iOS client accepts public endpoints only over HTTPS, refuses redirects and stores
pairing credentials in device-only Keychain. The gateway serves a fixed allowlist of web assets. TypeScript compilation carries the
application code as external scripts; a shared build helper packages installed xterm browser
distributions for both development and release. The client needs no separate web server.

Web API calls require the same bearer token and reject foreign or null browser origins and
cross-site fetches. There is no CORS allowance. The public app shell contains no session data
or credential, so incoming navigation links can reach it without authentication. CSP blocks
inline scripts and framing. Pairing web links carry the key only in a fragment, removed
before connecting; it never reaches HTTP request paths or referrers. Remember this device
stores the key in that browser's local storage. The optional native client remains useful
when device-only Keychain storage is required. No service worker caches screens or inputs.

Keep `Referrer-Policy: same-origin`: Safari serializes a same-origin POST's `Origin` as
`null` under `no-referrer`, so an otherwise valid Send fails the gateway's origin check.
Foreign and null origins remain rejected; pairing keys remain fragment-only.

The selected shared folder bounds directory browsing and new tabs; existing remote sessions
remain accessible by their exact registered identities. Canonical paths enforce containment, and
the browser omits symlinks instead of offering a route outside the shared root.

`remote-access.json` and `remote-actions.json` are main-only private files with mode 0600.
The latter stores hashes and timestamps, never command text or pairing keys. Every mutation
has a timestamped idempotency key. Its reservation reaches disk before input/spawn starts;
concurrent retries share one result. After a process restart, an existing reservation is
reported as uncertain and cannot execute again. Keys expire after 24 hours, with bounded
history. Resetting pairing revokes the old bearer key. The native Send client retains drafts on failure,
never submits automatically on reconnect, and retries uncertain requests with the same
key and payload. Review the terminal before editing a failed instruction into a new action.

Quota uses CLI Manager's existing cache and marks missing/stale/offline readings. It never
refreshes provider allowances or switches an account. A requested account is checked
against that source before a new tab receives the validated `cli <id>` command.

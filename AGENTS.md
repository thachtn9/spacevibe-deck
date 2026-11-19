# AGENTS.md — SpaceVibe Deck

## Local Linux baseline

This checkout starts from upstream tag `v2.10.0` (`d23991cc9d021322c6669a4e5beca5d5f76804fe`).
The owner requested Deck's existing experience on Linux first, with customization deferred.
Work in place, in one agent session; do not create worktrees or Superpowers plan files.
Linux uses the Ctrl keymap and POSIX process groups; cwd discovery uses `/proc/<pid>/cwd`.
Rail matching falls back to the opened path's Git scan root when symlinks such as
`/home/thachtn9/data` resolve to `/data`; tab workspace paths stay as the user opened them.
The Electron rail nests child projects beneath the nearest displayed parent folder.
Nesting is presentation only: project identities and session focus/close targets stay separate.
Plain-folder scans include their resolved alias path so adding a symlink parent after its
canonical child automatically re-nests the existing row without changing terminal paths.
`npm run build:linux` builds Electron without regenerating the frozen Tauri menu.
After completing code changes and their scoped verification, always run `npm run build:linux`
before handing the work back. This owner requirement authorizes the local renderer and Electron
builds without asking again. Report any build failure; do not claim completion until it is resolved.
`npm run electron:package:linux` creates local AppImage/deb artifacts. Linux auto-update is
unsupported until a dedicated feed exists; upstream's feed only serves macOS/Windows.
See [the Linux runbook](docs/operations/linux.md) for setup and launch commands.
The local agent selection is Codex and AGY. Their stable ids remain `codex` / `agy`,
but discovery and launch use `cli-codex` / `cli-agy`. A one-time Linux startup setting
disables other built-ins and pins these two; subsequent user settings remain editable.
Claude's Electron API connection form lives under Settings > Agents > Claude Code. It merges
the gateway, model and key into Claude's private user settings using the hook installer's
existing file lock. Never return a saved key to the renderer; draft connection tests do not save.
Gateway tests use Electron's Chromium network stack so system proxies are honored.
Git folders show a branch tier above their sessions, including the primary checkout; plain
folders and a primary detached HEAD omit it. Folder, branch and session indents use one 14px step.
Linux resolves launcher descendants only while stdin still belongs to that pane's tty;
AGY's open presence lock supplies its exact session id. Codex's OSC conversation title can
supply rail display text when a shared daemon owns its session files, never a resume identity.
Focus Expand stays enabled. On Linux, resize also notifies descendants outside the
pane shell's session that still read from that pane's tty: `cli-agy` launches through
`dbus-run-session` with `start_new_session=True`, so the kernel's foreground-only
SIGWINCH misses AGY. Notify the CLI behind the launcher, not just the session leader.
Pane fitting drains xterm's pending parser writes before changing geometry, so
cursor-relative CLI frames are interpreted at the width they were written for.
Focus Expand fits panes on the split's `transitionend`, avoiding an extra 90ms
debounce after the animation; ordinary resize events retain the debounce.
AGY erases its response before a delayed full redraw on resize. Its pane batches
that output until the complete synchronized repaint, bounded to 250ms/256K characters,
so the intermediate empty frame is not displayed; normal streaming stays immediate.
The AGY banner also enables this renderer workaround when process polling only
sees the detached CLI's Python wrapper.
The Quota dock and rail read CLI Manager's existing `GET /api/status` at
`http://cli-manager.localhost:1428/` through Electron-only `cli_manager_quota`.
Percentages are remaining allowance. Both surfaces share a 30-second poll;
the dock no longer starts token-history scans or agent allowance collectors.
The left sidebar splits folder-tree and quota space with independent scrolling. Its Quota
footer icon persists `railQuotaOpen` separately from the right dock; Session history is right-only.
The left quota region shows only Codex; the right dock retains both Codex and AGY.
Left account rows place names beside two slim, labelled remaining-quota bars (5h above, 1w
below), with percentages always visible. The sidebar has no provider heading or account count.
Reset labels replace the exhausted window's bar on the same line only at zero
(short window as hours and minutes, minutes only below one hour; weekly window as local date/time). Missing quota stays unknown, and stale/offline
readings stay labelled. The detailed right quota table remains available.
Right-dock quota groups collapse independently and list Codex first. Double-clicking an
account or dropping it onto a terminal body adds a split; a single click never launches.
Dropping an account onto a pane header stops its agent and resumes the exact live
conversation with `cli resume <session-id> --acc <account>` in the same PTY. Require
the same agent, a proven process-bound session id and a fresh idle shell before writing;
never fall back to latest. Preserve cwd, tab ownership and pinned placement. Linux GUI
main also stops tty-bound detached descendants so this works with older terminal services.
Account handoff discards pane input and drains pending writes before stopping. After the
shell returns, reset xterm's mouse/focus/paste/alternate-screen modes, clear pending readline
input and restore POSIX tty settings before resume. Emit the reset through PTY output too
so the persistent screen cannot restore a killed TUI's mouse capture. Never queue mouse
reports during handoff to replay into the shell or replacement agent.
Account switching waits for fresh identity metadata; GUI main isolates new Codex launches
even when an older service cannot. Existing shared app-server clients can remain unidentifiable;
never recover their session from a title, cwd or remembered resume command.
Linux Codex handoff verifies the original PID generation, tty, session and process group in GUI
main, waits for process exit and kernel writer-lock release, and confirms the replacement's
session/account before reporting success. Only the TUI's own acquired locks or writable
interactive rollout establish identity; a descendant shared daemon may own other panes' threads.
Pane-local logs diagnose current-invocation lock failures only, never a resume identity.
Do not kill a shared Codex daemon or delete its lock files to unblock an account switch.
Keep the journal's canonical `cli resume <id> --acc <account>` form, but execute Codex
resumes through `cli <account> resume <id>` with the invocation-local log override. CLI
Manager's history-resume branch drops extra flags and does not pin the Codex account;
its explicit-account launch branch forwards both. GUI main normalizes older service replies too.
Dropping onto a project or checkout label in the rail opens a separate tab at
that folder. Launch the exact `cli <id>` command after validating the account
id; splits inherit the target pane's fresh cwd and retain its session.
Alt+C opens a bounded fuzzy folder picker rooted at `/home/thachtn9/data`.
Enter materializes a separate shell-only tab; Escape cancels. Browse reaches
folders outside the search root. The shared picker signal participates in modal shortcut guards.
Session history uses CLI Manager's read-only `/api/sessions` through Electron's
existing `sessions_list` command. The visible filters are All, Codex and AGY.
Preserve account and machine metadata through IPC; resume with
`cli resume <id> --acc <account>` in a new single-pane tab at the recorded cwd.
Remote-client and unavailable-folder entries cannot resume locally. Manager
entries use supplied titles, not the legacy default-profile transcript scanners.

Persistent snapshots preserve the mouse wire encoding alongside tracking. xterm's serializer
omits SGR encoding, so never use its output alone for reattachment. The client repairs legacy
Codex snapshots without restarting the old daemon or changing explicit mouse modes.
Linux Electron keeps PTYs in a detached, per-userData terminal service. UI close/quit detaches;
explicit pane/tab close kills. Journal `terminalRef` values combine the daemon epoch and pane id,
so a restarted daemon cannot reuse an old identity. Boot automatically restores layouts and
reattaches live screens; after reboot it uses `terminal-recovery.json` for exact session/account
resume. Never fall back to a different conversation when identity is unavailable.
Codex activity after reattachment comes from the exact conversation's task lifecycle records;
screen serialization omits the earlier OSC progress event. Keep lifecycle facts bound to the
live pane's process and session, and restore historical completion without notification sound.
Direct hook replies must update the desktop widget's last assistant line as well as rail tails.
Deck-launched
Codex commands receive `--no-daemon` and an invocation-local `log_dir` so their open rollout can establish identity
without guessing among a shared app-server's sessions; bound those logs. AGY identity remains its
open presence lock. Test persistence with scratch userData and clean up only test-owned processes.

Changes & commits and Files are retired from the right dock by owner request. The dock
shows Quota and Session history; saved explorer selections resolve to Quota. Do not restore
file/review entry points or background Git review scans without an explicit request.
The owner-requested View code surface opens in a separate, maximized Electron window.
It reuses the guarded file controller and lazy Monaco, with a tree, file tabs, bounded fuzzy
file lookup and Find / Go to line. It never creates a terminal or enables file writes.
Viewer windows reuse the canonical folder identity, have a restricted preload and stay outside
the terminal coordinator, journal and close census. In-workspace terminal file links focus
the matching viewer and reveal the exact file/line; other paths retain external routing.
The header's Text Editor opens a separate Electron-only Monaco window for editable UTF-8
files and local notes. It owns no PTYs or terminal journal. Drafts persist atomically with
mode 0600 under userData/text-editor/workspace.json; unreadable snapshots stay intact.
File saves compare the original content fingerprint before writing. App quit first asks the
editor to flush drafts through its IPC close guard, then resumes the existing terminal quit flow.
View code opens on another monitor when available. Linux Wayland uses a separate XWayland
viewer helper because native Wayland disallows window positioning. It selects the other
display from the launch pointer, while a bounded pipe delegates reads, Git and preferences
to the owning GUI. The helper owns no terminal or journal and exits when its parent pipe ends.
Keep Deck's own display backend unchanged; do not switch the primary monitor for placement.
View code's Source control tab reuses Git review channels for working diffs, recent history
and commits not reachable from a selected target branch. It distinguishes publication to
the checkout's upstream from target ancestry; squash/rebase is not proof of PR merge state.
Git review runs only while that tab is mounted; remote refs update only through explicit Fetch.
Each repository's X hides it from Source control, preserving its files and stopping its reads.
Hidden repository paths persist per opened root in workspaces.json; Show hidden folders restores them.
Prompts and Browser are also retired from menus, shortcut settings and toolbars. The rail
create row exposes Folder only: picking a directory opens a shell-only tab there immediately,
then remembers it. Folder headers and checkout menus offer Open in VS Code and Open folder;
Linux uses an executable code command with argv and Electron shell.openPath respectively.

Browser Review runs in the unpacked Chrome Manifest V3 extension under extensions/deck-review.
A dedicated authenticated bridge binds 127.0.0.1:43129, separate from Deck Remote. The extension
connects without a pairing code using its pinned public Chrome identity and a private bridge token;
ordinary web origins cannot connect. The Chrome side panel and folder pairing entry are retired.
Right-click a live rail session to select the single Active Browser Review target. Keep its exact
conversation/process/pane identity; Linux shared-daemon clients may use a tty-bound PID
generation for Browser Review only, never for resume or account switching; replacing or restarting it requires selecting Active again.
The movable top-center toolbar's Send submits saved comments for the current page immediately.
Allow Browser Review sends while agents are working; submitted requests belong to the CLI.
Reject unsent composer drafts and approval prompts without queueing. Reserve batch and write identities
before terminal side effects; retry the same batch after a lost reply, never replay uncertain or
partially pasted input. Drafts remain in Chrome until confirmed sent. Dismiss delivery requires
checking the agent first. Extension requests cannot read arbitrary files or write arbitrary text.
Capture URL, viewport, DOM evidence and screenshots together; React/Angular hints are optional
and untrusted. The annotation UI uses a compact neutral-dark toolbar and comment popup with
14px input text, thin selection outlines and numbered pins. Rebuild the shared collector with
node scripts/build-review-extension.mjs after changing electron/web-review/inject.ts.
Test browser and Electron with scratch profiles only.

Pinned terminals belong to their original tab but render in a window-level split around the
selected workspace. Only dragging a rail session onto a pane or workspace edge creates a pin; account
drops onto terminal bodies and splits create ordinary panes. Header account drops preserve
the existing pin. The pane header only offers unpin for existing pins.
Rail drops split the hovered pin or workspace at the chosen edge, with a matching preview;
dragging an existing pin from the rail repositions it without duplicating it.
Drag a pinned pane by its header to dock beside another pin or the workspace; Ctrl-drop on
Linux swaps their positions. Reordering preserves pin state and the original terminal identity.
Switching folders leaves pins visible; input and pane shortcuts follow the focused pane.
Selecting a folder whose tab contains only pinned terminals hides the ordinary workspace,
so pins fill the stage. Returning to another folder restores its still-running terminals.
Unpin returns to the original tab. Closing that tab explicitly closes its pins through the
existing close guard. Journal pane placements restore nested split paths as well as legacy
pin order, edge and split ratio without
changing persistent PTY references. Never respawn or transfer a PTY just to pin it.

> **Boundary:** standalone desktop app; no shared DB or API with the SpaceVibe web repos.
> Deck Remote has a Safari web client and an optional native iOS client of this Electron
> host, with a disabled-by-default gateway. Linux-only owners use Copy web link and Safari's
> Add to Home Screen; no separate web server is required.
> On Linux, Remote uses an independent workspace and a dedicated persistent terminal service
> under `userData/remote-workspace`; it never attaches to desktop PTYs or creates desktop tabs.
> Session IDs and epoch-qualified PTY references persist in its private `workspace.json`.
> Browser close releases input only; explicit remote session close kills only that remote PTY.
> GUI restart reattaches exact live remote references without spawning replacements; dead
> references stay ended. Browser-local selection, folders and split preferences stay separate
> from desktop state. Other Electron platforms retain the renderer-backed compatibility path.
> Keep timestamped mutation reservations durable before side effects; uncertain requests
> after a restart must not replay. Main owns pairing keys; native iOS uses Keychain and the
> web client's Remember this device uses browser local storage. Web links use a fragment
> removed before connection; allow only same-origin browser API calls, never broad CORS.
> See [Deck Remote internals](docs/internals/deck-remote.md). Native builds need Xcode on macOS.
> Remote web uses one compact header and the folder tree for session navigation, without
> session tabs or pane session pickers. Touch icon buttons are 34px; native input text is 16px.
> The composer stays in flex flow within the visualViewport height so Safari can reveal it
> above the keyboard. Quota, follow output and connection controls live in the header menu;
> web icons use static regular Phosphor paths without a client component runtime.
> The web workspace uses packaged xterm distributions and authenticated ANSI streams, with a
> private per-connection sequence ledger reserved before raw input. Its service answers
> protocol queries; browser keyboard/resize never changes a desktop PTY on Linux. Input leases
> arbitrate between browsers only. Preserve mouse encoding and NFC graphemes in snapshots.
> Linux desktop agent activity uses a separate transparent XWayland helper, fed by the
> existing renderer activity snapshots. Keep it outside the coordinator/PTY/journal census;
> source ownership is rechecked on activation, and closing Deck ends the helper via stdin.
> Do not edit sibling repos from this session. Workspace map: [`../AGENTS.md`](../AGENTS.md).

Deck is a terminal for running many agent CLIs side by side. `main` carries **two hosts**: the
Tauri 2 + Rust host, feature-frozen and built only by hand, and the Electron host in
`electron/` that has replaced it on every tag. The renderer is Preact + xterm.js and reaches
whichever host it runs under through the facades in `src/host/`. Everything in this repo — UI
strings, comments, docs, and commits — is **English only**.

Read [docs/internals/overview.md](docs/internals/overview.md) before your first change. The
documentation index is [docs/README.md](docs/README.md).

## Current direction

- **Auto-update is a core requirement.** A release is not complete if distribution falls back
  to manual download. Release artifacts include the updater payloads and manifests described
  in [operations/release.md](docs/operations/release.md).
- **Tauri is feature-frozen.** New product features land on Electron so they are not
  implemented twice. A renderer change reaches both hosts; a change needing a new host command
  is Electron-only and degrades on Tauri through an `available` flag, never a second
  implementation. Say which host a change runs on rather than implying both.
- **Windows ships unsigned by decision.** See the
  [platform limits](docs/operations/release.md#platform-limits).
- **Analytics is mandatory** — always on, no opt-out, and the disclosure stays. The contract is
  [internals/telemetry.md](docs/internals/telemetry.md); the receiving service is
  [backend/](backend/README.md).
- **The Electron cutover is a clean install**, with no settings or workspace migration.
- **The navigation rail refresh runs as a queue.** Its
  [spec](docs/specs/2026-10-06-navigation-rail-refresh.md) lists the slices in order; the first
  row not `Done` is the next work. That slice's plan carries an Operating contract: once the
  owner approves the plan, the contract is your authorization — run its tasks and gates
  without asking again, and stop only for the hard stops it names.

Where the current behaviour of a surface is written down:

| Surface                                                | Page                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| Process model, IPC bridge, persistence, R4 seams        | [internals/overview.md](docs/internals/overview.md)               |
| PTYs, panes, tabs, materialization, launch, phase, menu | [internals/terminal.md](docs/internals/terminal.md)               |
| The rail tree, checkouts, tails, close and order        | [internals/agent-rail.md](docs/internals/agent-rail.md)           |
| Spaces, the strip's marks, the slide, Mission Control   | [internals/mission-control.md](docs/internals/mission-control.md) |
| The Agent Board (retired, still builds)                  | [internals/agent-board.md](docs/internals/agent-board.md)         |
| Explorer, editor, markdown, browser tab, path opening   | [internals/file-surface.md](docs/internals/file-surface.md)       |
| The journal, last-session offer, resume resolution      | [internals/session-restore.md](docs/internals/session-restore.md) |
| Usage analytics                                         | [internals/telemetry.md](docs/internals/telemetry.md)             |
| Traps, live switches, accepted limitations              | [internals/traps.md](docs/internals/traps.md)                     |
| Vocabulary this repo uses precisely                     | [internals/glossary.md](docs/internals/glossary.md)               |
| Visual invariants and current surface patterns          | [docs/DESIGN-LANGUAGE.md](docs/DESIGN-LANGUAGE.md)                |

Closed decisions, measurements and long rationale live in git history and in the issue that
owned the work — not in this file.

## Forks

Stop and ask before writing code when a task touches:

- PTY ownership, process classification, the window coordinator, tab materialization, layout
  or close/quit coordination, on either host;
- bundle, dependency, signing, release channel, updater or version configuration;
- an **invariant** in [docs/DESIGN-LANGUAGE.md](docs/DESIGN-LANGUAGE.md) (§1–4, §7, §20,
  §21: tokens, color roles, typography, motion and resource budget, scales, interaction
  states; a rule marked _(pattern)_ there is not one);
- Electron/Tauri cutover scope;
- any sibling repo.

Not a fork: internal renames, tests, editing the menu registry, and replacing a DL
**pattern**. A pattern describes how a surface looks today; a redesign rewrites it in the
same change as the code once the owner has reviewed the result by eye. Gallery specimens,
prototypes and design proposals are not bound by patterns at all: propose the strongest
design and list the patterns it would replace, rather than shrinking the idea to fit.

Record a resolved fork on the issue that owns the work, with the alternative you turned down
and why — a fork nobody can reconstruct is a decision that will be re-litigated.

## Verification and commands

| Command                       | Purpose                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                 | browser-only Vite preview; IPC operations fail soft                                                                                                                     |
| `npm run tauri dev`           | the Tauri host                                                                                                                                                          |
| `npm run electron:dev`        | Electron dev with renderer HMR and incremental main/preload rebuilds via [`scripts/electron-dev-watch.mjs`](scripts/electron-dev-watch.mjs) |
| `npm run electron:dev:watch`  | alias for `electron:dev` |
| `npm run electron:dev:once`   | build and launch once from the static renderer bundle through [`scripts/electron-dev-launch.mjs`](scripts/electron-dev-launch.mjs) |
| `npm run electron:build`      | typecheck and bundle the Electron main process                                                                                                                          |
| `npm run electron:package`    | package the Electron host as a local **unsigned** `Deck Electron.app` (arm64, `dir` target, no installer/updater/publish) into `dist-electron-app/`                     |
| `npm run electron:smoke`      | headed smoke test; needs a display server and a real PTY                                                                                                                |
| `npm test`                    | Vitest suite                                                                                                                                                            |
| `npm run build`               | TypeScript + shipping renderer bundle                                                                                                                                   |
| `npm run generate:menu`       | regenerate menu from registry                                                                                                                                           |
| `npm run generate:menu:check` | prove generated menu is current                                                                                                                                         |
| `npm run lint`                | oxlint + prettier check; max-lines stays a warning (101 pre-existing over-length files are backlog)                                                                     |
| `npm run prototype:gallery`   | visual comparison gallery at `127.0.0.1:5175`                                                                                                                           |
| `npm run build:landing`       | landing production build                                                                                                                                                |
| `npm run video:render`        | render marketing video from DOM stage                                                                                                                                   |

**Main stays green (owner, 2026-10-09).** Before pushing a code change, run the tests beside
the files you changed, lint them, and run `scripts/` and `src/styles/` — the policy suites that
read stylesheets and docs and fail when a ledger falls behind. The
[`pre-push`](.githooks/pre-push) hook runs exactly that set, installed by `npm install`; do not
bypass it with `--no-verify` to land a red change. The policy suites read the working tree, so in a
checkout holding another session's uncommitted files they can fail on that work: push from a
clean worktree instead. A test your change breaks gets updated in
the same commit. The full test suite stays CI's job and runs locally only when asked. After scoped verification,
always run `npm run build:linux` as required by the owner in the Local Linux baseline; this
includes the renderer and Electron builds. Report checks actually performed. Manual native acceptance, real-device upgrade checks, and Windows install/update checks run
only when explicitly requested; they are not prerequisites for release completion or issue
closure. Report checks actually performed without treating omitted checks as successful.

**E2E gate for large features (owner, 2026-10-08).** The one exception to "only when asked": a
new user-facing feature or a change to a UI flow — a new surface, command or interaction, or a
spec slice — is not reported done until an agent has driven the affected flows in the running
Electron app with `playwright-core`, already a dev dependency. Bug fixes, styling, copy,
refactors, tests and docs skip it. How to run it:

- Write a scratch wrapper that calls `app.setPath("userData", <scratch dir>)` before requiring
  `dist-electron/electron/main.cjs`, and drive it from a scratch script with
  `_electron.launch({ executablePath: <node_modules/electron/dist/Electron.app/Contents/MacOS/Electron>, args: [<wrapper>] })`,
  then `app.firstWindow()`. A plain `electron:dev` writes the owner's real `workspaces.json`
  and `session.json`.
- Do not test through Playwright MCP or a browser tab on `npm run dev`: those reach only the
  browser preview and prove nothing about IPC, PTYs or persistence.
- Report each flow walked and its result; screenshots go to scratch, not the repo. The gate
  covers Electron only — say so for a change that also reaches Tauri.

## Layout

Both hosts are installed in this checkout, so Electron and its native dependencies belong
here. Adding a feature to one host without the other leaves a parity gap.

## Sessions and checkouts

Several agent sessions run against this repo at once. The owner's standing rule (2026-09-26):

- **One writer per checkout.** At most one session edits this primary checkout at a time. A
  short fix that finishes in one pass works here, on `main`.
- **A parallel coding session works in its own worktree** — this is standing authorization to
  branch: `git worktree add ../../spacevibe-deck-worktrees/<slug> -b <type>/<slug> main`, then
  `npm install` inside it. If `git status` shows fresh changes you did not make, stop and ask
  whether to move to a worktree instead of editing around them.
- **One `electron:dev` at a time.** Dev runs share the owner's real userData and the Vite port
  across checkouts.
- **Merge the same day.** Rebase on `main`, fast-forward `main` to the branch, then
  `git worktree remove` and delete the branch. Write the `CHANGELOG.md` entry on `main` at merge
  time, not on the branch. Keep at most three worktrees alive; work that stays open overnight
  records why in its plan.

## Repo rules

- **R1. English only** for strings, comments, docs and commit messages.
- **R2. Design language has two tiers.** Tests enforce the DL invariants. The DL patterns
  describe shipped surfaces, and a redesign may replace them. Cite a rule in a comment only
  when the code would look wrong without the reason. A cited number must stay declared.
- **R3. Menu output is generated.** Edit the registry, then run `generate:menu`; never edit
  generated menu code manually.
- **R4. Load-bearing seams stay explicit.** PTY/window/tab/layout/close modules require a plan
  and cross-boundary verification, not a drive-by refactor.
- **R5. Renderer state uses Preact signals; module stores are window-scoped.**
- **R6. IPC payload shape is a contract.** Keep flat command arguments where the frozen
  frontend contract sends flat keys; `scripts/electron-ipc-contract.test.ts` guards this
  boundary in `npm test`.
- **R7. Gallery imports flow app → gallery only.** Shipping modules must not import
  `src/gallery/` or its stubs.

## Known traps

The full list, with the live switches and the limitations that were looked at and accepted, is
[internals/traps.md](docs/internals/traps.md). The four that catch people first:

- The app running an update is the **old build**; an updater fix cannot protect the transition
  into the release that carries it.
- **Browser `npm run dev` paints the shell** because IPC failures are caught. It proves nothing
  about persistence, PTY, the updater or packaging.
- **`src/styles.css` has no global `box-sizing` reset**, so a percentage size beside a padding
  overflows its box. Form controls get `border-box` from the user agent; a plain element does
  not. Two shipped defects came from exactly this in one day.
- **A one-pixel overflow moves the whole window.** `#root` is `overflow: clip`, not `hidden`,
  because `hidden` still builds a scroll container. Treat "the top bar looks misaligned" as a
  scroll report, not a layout one.

Old `FR-` and `ADR-` references are historical. Do not recreate `PIPELINE.lock` or
`docs/decisions/` merely to satisfy those comments.

## Documentation

Most code changes need no documentation change; agents and maintainers can read the code. The
index is [docs/README.md](docs/README.md).

- `docs/internals/` holds architectural decisions and their reasons, constraints that span
  modules, and traps hard to discover from the source. Before adding a paragraph, ask what a
  maintainer would get wrong without it. It is the one place in the repository that still
  takes new documentation.
- `docs/user/` helps users accomplish tasks, in the voice of the shipped product, with no
  implementation detail and no contributor tooling. A UI tweak needs no entry.
- `docs/operations/` is the maintainer runbook: setup, release, debugging. Every page under
  `internals/` and `operations/` opens with the "For maintainers" callout.
- Do not write file catalogs, field or method enumerations, control-flow narration, or
  appended PR summaries. When a documented decision changes, rewrite or remove the text; never
  append a second account. Keep a local explanation in a code comment; use an internal page
  only when the reasoning crosses boundaries.
- **Specs under `docs/specs/` are committed** so a reset or a fresh worktree cannot lose
  them (owner, 2026-10-07). **Plans, research notes and review reports are not.** A merged PR
  is the implementation record. Active work lives in a local plan under `docs/plans/`, which is
  gitignored, so it exists only in the primary checkout: a session in a worktree reads and
  updates it there by absolute path.
- `docs/DESIGN-LANGUAGE.md` stays at its path and keeps its numbering: a test reads it, and
  code comments cite its rules. `CHANGELOG.md` is read by the release workflow.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **spacevibe-deck** (26738 symbols, 78940 relationships, 854 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/spacevibe-deck/context` | Codebase overview, check index freshness |
| `gitnexus://repo/spacevibe-deck/clusters` | All functional areas |
| `gitnexus://repo/spacevibe-deck/processes` | All execution flows |
| `gitnexus://repo/spacevibe-deck/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

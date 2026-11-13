import { remoteWorkspaceStyle } from "./web-workspace-style";
export const remoteWebStyle = `
:root {
  color-scheme: dark;
  --bg: #0a0a0a;
  --fg: #cbcbcb;
  --sidebar-bg: #141414;
  --accent: #7aa2f7;
  --red: #f7768e;
  --green: #9ece6a;
  --yellow: #e0af68;
  --muted: #a0a0a0;
  --hair: #303030;
  --hover: #242424;
  --chrome-1: #1c1c1c;
  --selected: #303030;
  --selection: #334a78;
  --primary-hover: #e3e3e3;
  --primary-active: #b3b3b3;
  --radius-tab: 6px;
  --radius-tight: 8px;
  --radius-control: 10px;
  --radius-surface: 12px;
  --duration: 150ms;
  --ease: cubic-bezier(0.4, 0, 0.2, 1);
  --type-title: 22px;
  --type-body: 16px;
  --type-meta: 13px;
  --ui-font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-family: var(--ui-font);
  font-size: var(--type-body);
  color: var(--fg);
  background: var(--bg);
  font-variant-numeric: tabular-nums;
  -webkit-text-size-adjust: 100%;
}
* { box-sizing: border-box; scrollbar-color: var(--muted) var(--bg); scrollbar-width: thin; }
[hidden] { display: none !important; }
body { margin: 0; }
h1, h2, h3, p { margin: 0; }
h1, h2 { font-size: var(--type-title); font-weight: 600; line-height: 1.3; }
h3 { font-size: var(--type-body); font-weight: 600; }
p { line-height: 1.5; }
button, input, textarea, select { font: inherit; color: inherit; }
button, input, textarea, select { border: 1px solid var(--hair); border-radius: var(--radius-control); }
button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 34px; padding: 6px 10px; font-size: var(--type-meta); background: var(--chrome-1); cursor: pointer; touch-action: manipulation; transition: background-color var(--duration) var(--ease), color var(--duration) var(--ease); }
button:active { background: var(--selected); }
button:disabled { color: var(--muted); cursor: default; }
input:not([type="checkbox"]), textarea, select { width: 100%; min-width: 0; padding: 9px 10px; background: var(--bg); min-height: 40px; }
input, textarea { caret-color: var(--accent); }
textarea { resize: vertical; max-height: 180px; line-height: 1.5; }
input::placeholder, textarea::placeholder { color: var(--muted); opacity: 1; }
select { text-overflow: ellipsis; padding-right: 28px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
::selection { background: var(--selection); color: var(--primary-hover); }
.icon { display: block; flex-shrink: 0; }
.icon-definitions { position: absolute; overflow: hidden; }
.primary { background: var(--fg); border-color: transparent; color: var(--bg); font-weight: 600; }
.primary:active { background: var(--primary-active); }
.primary:disabled { background: var(--chrome-1); color: var(--muted); border-color: var(--hair); }
.quiet { background: transparent; border-color: transparent; color: var(--muted); }
.muted, .section-description, .session-meta, .session-path { color: var(--muted); }
.check { display: flex; align-items: center; gap: 9px; font-size: var(--type-meta); min-height: 34px; cursor: pointer; }
input[type="checkbox"] { flex-shrink: 0; width: 16px; height: 16px; margin: 0; accent-color: var(--fg); }
.pair-view { max-width: 480px; margin: 0 auto; padding: max(64px, env(safe-area-inset-top)) 24px max(32px, env(safe-area-inset-bottom)); }
.app-icon { display: block; margin-bottom: 24px; }
.pair-description { color: var(--muted); margin-top: 10px; max-width: 30ch; }
.pair-form { display: grid; gap: 12px; margin-top: 32px; padding: 20px; border: 1px solid var(--hair); border-radius: var(--radius-surface); background: var(--sidebar-bg); }
.pair-form > label:first-child { font-weight: 600; }
.pair-form .primary { margin-top: 4px; }
.pair-form input:not([type="checkbox"]) { font-size: var(--type-body); }
.setup-notes { margin-top: 24px; font-size: var(--type-meta); }
.setup-notes summary { min-height: 44px; padding-block: 12px; cursor: pointer; }
.setup-notes > div { padding-bottom: 16px; color: var(--muted); }
.setup-notes h2 { color: var(--fg); font-size: var(--type-body); margin: 20px 0 8px; }
.disclosure { margin-top: 28px; color: var(--muted); font-size: var(--type-meta); }
noscript { display: block; margin-top: 20px; }
#pair-error, .error { color: var(--red); }
.app-view { position: fixed; top: var(--remote-top, 0px); left: 0; right: 0; display: flex; flex-direction: column; max-width: none; height: var(--remote-height, 100dvh); min-height: 0; margin: auto; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); overflow: hidden; background: var(--bg); }
.app-header { display: flex; align-items: center; gap: 10px; flex-shrink: 0; min-height: 58px; padding: 8px 10px; border-bottom: 1px solid var(--hair); background: var(--sidebar-bg); }
.app-brand { flex: 1; min-width: 0; }
.app-brand > div { min-width: 0; }
.app-header h1 { font-size: var(--type-meta); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon-button { flex-shrink: 0; width: 34px; height: 34px; min-height: 34px; padding: 0; }
.app-view[data-view="sessions"][data-detail="false"] #back-sessions, .app-view:not([data-view="sessions"]) #back-sessions { display: none; }
.network-status { display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: var(--type-meta); color: var(--muted); }
.network-status::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--red); flex-shrink: 0; }
.network-status[data-online="true"]::before { background: var(--green); }
.connection-menu { position: relative; flex-shrink: 0; }
.connection-menu > summary { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; list-style: none; cursor: pointer; background: var(--chrome-1); border: 1px solid var(--hair); border-radius: var(--radius-control); }
.connection-menu > summary::-webkit-details-marker { display: none; }
.connection-menu:not([open]) .menu-content { display: none; }
.menu-content { position: absolute; top: calc(100% + 8px); right: 0; z-index: 20; display: grid; gap: 8px; width: min(230px, calc(100vw - 24px)); max-height: calc(var(--remote-height, 100dvh) - 80px); overflow: auto; padding: 10px; background: var(--sidebar-bg); border: 1px solid var(--hair); border-radius: var(--radius-surface); }
.menu-content button { width: 100%; justify-content: flex-start; }
.menu-content .check { padding-inline: 4px; }
.menu-label { font-size: var(--type-meta); color: var(--muted); padding-inline: 4px; }
.menu-content select { font-size: var(--type-body); }
.main-nav { display: grid; gap: 4px; }
.main-nav button { background: transparent; border-color: transparent; color: var(--muted); }
.main-nav button[aria-pressed="true"] { background: var(--selected); color: var(--fg); }
.notice { flex-shrink: 0; max-height: 24svh; overflow: auto; margin: 8px 10px; padding: 8px 10px; background: var(--sidebar-bg); border: 1px solid var(--hair); border-radius: var(--radius-control); font-size: var(--type-meta); overflow-wrap: anywhere; }
.pair-form .notice { margin: 0; padding: 0; border: 0; }
.app-content { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.sessions-view { display: flex; flex: 1; min-height: 0; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.section-heading > div { min-width: 0; }
.section-heading h2 { display: flex; align-items: center; gap: 8px; font-size: var(--type-body); }
.section-description { font-size: var(--type-meta); margin-top: 4px; }
.section-heading button { flex-shrink: 0; }
.count { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; min-height: 22px; padding-inline: 6px; border-radius: var(--radius-tab); background: var(--chrome-1); color: var(--muted); font-size: var(--type-meta); font-weight: 400; }
.session-sidebar, .content-view { min-height: 0; overflow: auto; padding: 16px 12px; }
.session-sidebar { flex: 1; min-width: 0; }
.search-field { display: flex; align-items: center; gap: 8px; padding-left: 10px; background: var(--sidebar-bg); border: 1px solid var(--hair); border-radius: var(--radius-control); color: var(--muted); }
.search-field:focus-within { border-color: var(--accent); }
.search-field input { border: 0; background: transparent; padding-left: 0; }
.search-field input:focus-visible { outline: none; }
.session-list { margin-top: 20px; }
.folder-group { display: flex; align-items: center; gap: 8px; color: var(--muted); margin: 24px 0 8px; }
.folder-group:first-child { margin-top: 0; }
.folder-group > div { min-width: 0; flex: 1; }
.folder-group h3 { color: var(--fg); font-size: var(--type-meta); overflow-wrap: anywhere; }
.folder-group p { font-size: var(--type-meta); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; margin-top: 2px; }
.folder-group .folder-count { font-size: var(--type-meta); }
.session-row { width: 100%; text-align: left; display: flex; align-items: center; gap: 10px; border: 0; background: var(--sidebar-bg); padding: 10px; margin-bottom: 4px; }
.session-row[aria-current="true"] { background: var(--selected); }
.session-row > .icon { color: var(--muted); }
.session-copy { min-width: 0; flex: 1; }
.session-copy strong { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: var(--type-body); font-weight: 600; overflow-wrap: anywhere; line-height: 1.4; }
.session-caption { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; font-size: var(--type-meta); color: var(--muted); margin-top: 4px; }
.session-account { overflow-wrap: anywhere; min-width: 0; }
.status-badge { display: inline-flex; align-items: center; gap: 5px; min-height: 22px; font-size: var(--type-meta); font-weight: 400; color: var(--muted); white-space: nowrap; }
.status-badge::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.status-badge[data-state="working"] { color: var(--accent); }
.status-badge[data-state="requested"], .status-badge[data-state="completed"], .status-badge[data-state="warning"] { color: var(--yellow); }
.status-badge[data-state="error"] { color: var(--red); }
.empty { color: var(--muted); padding: 24px 8px; font-size: var(--type-meta); }
.session-detail { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.terminal-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; background: var(--bg); }
.screen-status { flex-shrink: 0; padding: 6px 10px; font-size: var(--type-meta); color: var(--muted); overflow-wrap: anywhere; }
.screen-status[data-state="live"] { display: none; }
.screen-status[data-state="error"] { color: var(--red); }
.terminal-screen { flex: 1; min-height: 0; width: 100%; font-family: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, "DejaVu Sans Mono", "Noto Sans Mono", Consolas, monospace; font-variant-ligatures: none; font-size: var(--type-meta); line-height: 1.55; white-space: pre; overflow: auto; margin: 0; padding: 12px 10px; tab-size: 4; overscroll-behavior: contain; }
.terminal-bold { font-weight: 700; }
.terminal-italic { font-style: italic; }
.terminal-underline { text-decoration: underline; }
.terminal-strike { text-decoration: line-through; }
.terminal-underline.terminal-strike { text-decoration: underline line-through; }
.terminal-dim { opacity: 0.5; }
.terminal-screen:focus-visible { outline-offset: -3px; }
/* The flex viewport keeps this in flow while visualViewport follows Safari's keyboard. */
.composer { flex-shrink: 0; padding: 8px 10px; border-top: 1px solid var(--hair); background: var(--sidebar-bg); }
.composer-field { display: flex; align-items: flex-end; gap: 8px; }
.composer textarea { flex: 1; min-width: 0; min-height: 36px; max-height: 96px; padding: 7px 10px; font-size: var(--type-body); line-height: 20px; resize: none; background: var(--bg); }
#send { margin-bottom: 1px; }
#send:not(:disabled) { background: var(--green); color: var(--bg); }
.composer-feedback { display: flex; align-items: flex-start; gap: 8px; max-height: 24svh; overflow: auto; }
.composer-feedback > button { flex-shrink: 0; margin-top: 6px; }
.input-note { flex: 1; min-width: 0; color: var(--muted); font-size: var(--type-meta); margin-top: 6px; overflow-wrap: anywhere; }
.input-note:empty { display: none; }
.composer[data-state="ready"] .composer-feedback, .composer[data-state="sending"] .composer-feedback { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.composer[data-state="error"] .input-note { color: var(--red); }
.composer[data-state="error"] textarea { border-color: var(--red); }
.select-session { display: none; align-self: center; justify-self: center; max-width: 36ch; padding: 32px; color: var(--muted); font-size: var(--type-meta); }
.select-session img { margin-bottom: 16px; }
.select-session h2 { color: var(--fg); font-size: var(--type-body); margin-bottom: 8px; }
.view-status { color: var(--muted); font-size: var(--type-meta); margin: 12px 0; overflow-wrap: anywhere; }
.view-status:empty { display: none; }
.quota-group { margin-top: 28px; }
.quota-group > h2 { font-size: var(--type-body); margin-bottom: 12px; }
.quota-account { padding: 18px 16px; margin-bottom: 10px; background: var(--sidebar-bg); border-radius: var(--radius-surface); }
.account-heading { display: flex; align-items: baseline; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-bottom: 14px; }
.account-heading strong { overflow-wrap: anywhere; min-width: 0; }
.account-heading span, .quota-note { font-size: var(--type-meta); color: var(--muted); }
.account-heading span[data-active="true"] { color: var(--green); }
.quota-window { display: grid; grid-template-columns: 28px minmax(0, 1fr) 52px; gap: 12px; align-items: center; margin: 12px 0; font-size: var(--type-meta); }
.quota-window > span:last-child { text-align: right; }
.quota-window[data-level="empty"] > span:last-child, .quota-window[data-level="low"] > span:last-child { color: var(--yellow); }
progress { width: 100%; height: 6px; appearance: none; border: 0; border-radius: var(--radius-tight); overflow: hidden; background: var(--hair); accent-color: var(--fg); }
progress::-webkit-progress-bar { background: var(--hair); }
progress::-webkit-progress-value { background: var(--fg); }
progress::-moz-progress-bar { background: var(--fg); }
.folder-heading { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; margin: 24px 0 16px; }
.folder-heading button { font-size: var(--type-meta); }
.folder-heading p { overflow-wrap: anywhere; font-size: var(--type-meta); color: var(--muted); }
.folder-list { max-height: 32svh; overflow: auto; padding: 4px; background: var(--sidebar-bg); border: 1px solid var(--hair); border-radius: var(--radius-surface); }
.folder-list:empty { display: none; }
.folder-row { display: flex; width: 100%; justify-content: flex-start; text-align: left; gap: 12px; padding: 14px 10px; border: 0; background: transparent; }
.folder-row > span { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.folder-row > .icon { color: var(--muted); }
.create-form { display: grid; gap: 12px; margin-top: 28px; }
.launch-options { display: grid; gap: 20px; }
.field { display: grid; gap: 8px; min-width: 0; }
.field label { font-size: var(--type-meta); font-weight: 600; }
.field select { background: var(--sidebar-bg); }
#create { margin-top: 8px; }
.content-view { width: 100%; max-width: 680px; margin: 0 auto; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.web-terminals { flex: 1; display: flex; min-width: 0; min-height: 0; overflow: hidden; }
.web-terminal-pane { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.web-terminal-pane + .web-terminal-pane { border-left: 1px solid var(--hair); }
.web-terminal-body { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 8px; }
.web-terminal-body .xterm { height: 100%; }
.web-terminal-body .xterm-helper-textarea { min-height: 0; padding: 0; border: 0; }
.web-terminal-status { min-height: 28px; padding: 5px 10px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--hair); }
.web-terminal-pane[data-controlled="true"] .web-terminal-status { color: var(--green); }
.folder-create-form { display: flex; gap: 8px; margin-top: 12px; }
.folder-create-form input { flex: 1; }
.folder-create-form button { white-space: nowrap; }
@media (max-width: 719px) {
  .web-terminals { flex-direction: column; }
  .web-terminal-pane + .web-terminal-pane { border-left: 0; border-top: 1px solid var(--hair); }
}
@media (hover: hover) {
  button:not(:disabled):hover { background: var(--hover); }
  .primary:not(:disabled):hover { background: var(--primary-hover); }
  .main-nav button[aria-pressed="true"]:hover, .session-row[aria-current="true"]:hover { background: var(--selected); }
}
@media (max-width: 719px) {
  .sessions-view[data-detail="true"] .session-sidebar { display: none; }
}
@media (min-width: 720px) {
  .app-view { border-inline: 1px solid var(--hair); }
  .session-sidebar { flex: 0 0 280px; border-right: 1px solid var(--hair); }
  .select-session:not([hidden]) { display: block; margin: auto; }
  .content-view { padding: 20px 24px 32px; }
  .launch-options { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
}
${remoteWorkspaceStyle}
`;

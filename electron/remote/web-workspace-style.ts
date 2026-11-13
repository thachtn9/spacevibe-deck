/** Desktop chrome shared in scale and surface roles with Deck's navigation rail. */
export const remoteWorkspaceStyle = `
:root {
  --type-title: 14px;
  --type-body: 13px;
  --type-meta: 12px;
  --tone: #fff;
  --text-primary: var(--fg);
  --text-muted: #b4b4b4;
  --text-faint: #929292;
  --chrome-1: color-mix(in srgb, var(--sidebar-bg) 97%, var(--tone));
  --chrome-2: color-mix(in srgb, var(--sidebar-bg) 94%, var(--tone));
  --hover: color-mix(in srgb, var(--tone) 6%, transparent);
  --selected: color-mix(in srgb, var(--sidebar-bg) 90%, var(--tone));
  --hair: color-mix(in srgb, var(--tone) 12%, transparent);
  --rail-width: 260px;
  font-size: var(--type-body);
}
body { overflow: clip; }
button { min-height: 28px; padding: 4px 9px; border-radius: var(--radius-tab); }
button:disabled { opacity: .65; }
input:not([type="checkbox"]), textarea, select { min-height: 34px; border-radius: var(--radius-tab); }
.icon { width: auto; }
.app-view { border: 0; }
.pair-view h1 { font-size: 24px; }
.pair-description { font-size: 15px; }
.pair-form { gap: 14px; }
.pair-form label, .pair-form button { font-size: 13px; }
.pair-form input:not([type="checkbox"]) { font-size: 16px; }
.pair-form button { min-height: 36px; }

.app-header { height: 40px; min-height: 40px; padding: 0 10px 0 0; gap: 10px; border-bottom: 1px solid var(--hair); background: var(--bg); }
.brand-app { display: flex; align-items: center; gap: 7px; flex: 0 0 var(--rail-width); align-self: stretch; padding: 0 14px; background: var(--sidebar-bg); }
.brand-app strong { font-size: var(--type-title); font-weight: 600; }
.brand-app img { border-radius: var(--radius-tab); }
.remote-badge { font-size: 10px; line-height: 16px; padding: 0 5px; border: 1px solid var(--hair); border-radius: 4px; color: var(--text-muted); }
.header-location { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--text-muted); }
.header-location > .icon { color: var(--text-faint); }
.header-location span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 240px; }
#workspace-session { color: var(--text-faint); }
.breadcrumb-divider { color: var(--text-faint); }
.app-brand { display: flex; justify-content: flex-end; margin-left: auto; flex: 0 0 auto; }
.network-status { font-size: 11px; margin: 0; color: var(--text-muted); }
.connection-menu > summary { width: 26px; height: 26px; border: 0; background: transparent; border-radius: var(--radius-tab); }
.connection-menu > summary:hover { background: var(--hover); }
.menu-content { border-radius: var(--radius-tight); }
.app-content { display: grid; grid-template-columns: var(--rail-width) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.app-content > section { grid-column: 2; grid-row: 1; }
.session-sidebar { display: flex; flex-direction: column; flex: none; min-width: 0; padding: 10px 8px 0; overflow: hidden; background: var(--sidebar-bg); border-right: 1px solid var(--hair); }
.sidebar-tools { display: flex; align-items: center; gap: 8px; padding-bottom: 10px; }
.sidebar-tools .new-session { gap: 5px; height: 25px; min-height: 25px; padding: 0 8px; background: transparent; color: var(--text-muted); }
.count { margin-left: auto; min-width: 0; padding: 0 4px; height: auto; background: transparent; font-size: 11px; color: var(--text-faint); }
.search-field { display: flex; align-items: center; gap: 7px; min-height: 28px; margin: 0 3px 12px; padding: 0 6px; background: transparent; color: var(--text-faint); border: 1px solid var(--hair); border-radius: var(--radius-tab); }
.search-field:focus-within { border-color: var(--accent); }
.search-field input { min-height: 26px; padding: 3px 0; border: 0; background: transparent; font-size: var(--type-meta); outline: 0; }
.search-field input:focus-visible { outline: 0; }
.session-list { margin-top: 0; flex: 1; min-height: 80px; overflow: auto; padding: 0 2px 12px; scrollbar-gutter: stable; }
.folder-group { display: flex; align-items: center; gap: 2px; margin: 10px 0 2px; padding: 0; }
.folder-group:first-child { margin-top: 0; }
.folder-toggle { display: flex; align-items: center; justify-content: flex-start; min-width: 0; flex: 1; gap: 6px; min-height: 28px; padding: 4px 2px; border: 0; background: transparent; color: var(--text-primary); text-align: left; font-size: var(--type-body); font-weight: 600; }
.folder-toggle span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.folder-toggle .icon:first-child { color: var(--text-faint); }
.folder-toggle[aria-expanded="true"] .icon:first-child { transform: rotate(90deg); }
.session-row { display: flex; gap: 9px; width: calc(100% - 14px); min-height: 34px; margin: 1px 0 1px 14px; padding: 5px 7px; background: transparent; border-radius: var(--radius-tab); color: var(--text-primary); }
.session-row { padding: 0; gap: 0; }
.session-open { display: flex; align-items: center; justify-content: flex-start; gap: 9px; min-width: 0; flex: 1; padding: 5px 7px; border: 0; background: transparent; color: var(--text-primary); text-align: left; }
.session-open > .icon { color: var(--text-muted); }
.session-close { flex-shrink: 0; width: 22px; height: 22px; min-height: 22px; padding: 0; margin-right: 4px; background: transparent; border: 0; color: var(--text-faint); opacity: 0; }
.session-row:hover .session-close, .session-row:focus-within .session-close { opacity: 1; }
@media (hover: none) { .session-close { opacity: 1; min-width: 30px; min-height: 30px; } }
.session-row > .icon { color: var(--text-muted); }
.session-row[aria-current="true"] { background: var(--selected); }
.session-copy strong { display: block; font-size: var(--type-body); line-height: 18px; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-caption { margin-top: 0; font-size: 11px; line-height: 16px; color: var(--text-faint); }
.session-row[data-shell="true"] { min-height: 28px; }
.session-row[data-shell="true"] .session-caption { display: none; }
.session-status { width: 6px; min-height: 6px; height: 6px; margin-left: auto; overflow: hidden; font-size: 0; flex-shrink: 0; }
.session-status::before { width: 5px; height: 5px; }
.sidebar-quota { flex: 0 1 auto; max-height: 34%; min-height: 90px; border-top: 1px solid var(--hair); padding: 12px 6px 4px; overflow: auto; }
.sidebar-quota-heading { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 6px; }
.sidebar-quota-heading strong { font-size: var(--type-meta); font-weight: 600; }
.sidebar-quota-heading > span { color: var(--text-faint); font-size: 10px; }
.sidebar-quota .quota-note:empty { display: none; }
.sidebar-quota .quota-note { font-size: 11px; margin: 4px 0 8px; }
.rail-quota-account { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 8px; padding: 9px 0; }
.rail-quota-account + .rail-quota-account { border-top: 1px solid var(--hair); }
.rail-quota-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-top: 2px; font-size: var(--type-meta); }
.rail-quota-name::after { content: attr(data-note); display: block; margin-top: 3px; color: var(--text-faint); font-size: 10px; }
.rail-quota-windows { min-width: 0; }
.rail-quota-windows .quota-window { grid-template-columns: 16px minmax(0, 1fr) 30px; gap: 5px; margin: 0 0 5px; font-size: 10px; line-height: 13px; }
.rail-quota-windows .quota-window[data-level="empty"] { grid-template-columns: 16px minmax(0, 1fr) 24px; }
.rail-quota-windows .quota-window > span:nth-child(2) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.rail-quota-windows progress { height: 4px; }
.sidebar-footer { display: flex; align-items: center; gap: 4px; min-height: 39px; margin-top: 6px; border-top: 1px solid var(--hair); }
.sidebar-footer button { gap: 6px; min-height: 28px; font-size: 11px; border-radius: var(--radius-tab); padding: 5px 7px; }
.sessions-view { min-width: 0; background: var(--bg); }
.session-detail { min-width: 0; width: 100%; }
#split-terminal { min-height: 28px; height: 28px; padding: 4px 6px; gap: 5px; border: 0; background: transparent; color: var(--text-muted); }
#split-terminal:hover, #split-terminal[aria-pressed="true"] { background: var(--hover); }
.web-terminals { gap: 4px; padding: 4px; background: var(--sidebar-bg); }
.web-terminal-pane { border: 1px solid var(--hair); border-radius: var(--radius-tab); background: var(--bg); }
.web-terminal-pane + .web-terminal-pane { border: 1px solid var(--hair); }
.web-terminal-body { padding: 8px 10px 4px; overflow-x: auto; overflow-y: hidden; touch-action: none; }
.web-terminal-status { min-height: 23px; padding: 4px 9px; border-top-color: transparent; color: var(--text-faint); font-size: 10px; line-height: 14px; }
.web-terminal-pane[data-controlled="true"] .web-terminal-status { color: var(--text-muted); }
.web-terminal-pane:only-child .web-terminal-status[data-state="live"] { display: none; }
.web-terminal-pane:not(:only-child) .web-terminal-status::before { content: attr(data-title) " · "; color: var(--text-primary); }
.content-view { width: 100%; max-width: 720px; padding: 36px 40px; margin: 0 auto; }
.content-view .section-heading { margin-bottom: 24px; }
.content-view .section-heading h2 { font-size: 22px; letter-spacing: -.02em; }
.content-view .section-description { margin-top: 8px; color: var(--text-muted); }
.folder-heading { gap: 12px; margin: 24px 0 12px; }
.folder-heading > p { padding: 10px 12px; width: 100%; background: var(--sidebar-bg); border: 1px solid var(--hair); border-radius: var(--radius-tab); font-size: var(--type-meta); }
.folder-list { max-height: 30dvh; padding: 4px; border-radius: var(--radius-tab); }
.folder-row { min-height: 36px; padding: 8px 10px; font-size: var(--type-body); border-radius: var(--radius-tab); }
.folder-create-form input { font-size: var(--type-body); }
.folder-create-form button { min-width: 100px; }
.create-form { margin-top: 26px; gap: 14px; }
.create-form select { min-height: 36px; font-size: var(--type-body); }
#create { min-height: 34px; }
.quota-group { margin-top: 24px; }
.quota-account { border-radius: 0; padding: 14px 0; margin: 0; background: transparent; border-top: 1px solid var(--hair); }
.account-heading { margin-bottom: 10px; }
.quota-window { font-size: var(--type-meta); }
.select-session:not([hidden]) { display: flex; flex-direction: column; justify-content: center; align-self: stretch; width: 100%; max-width: none; margin: 0; padding: 48px; }
.welcome-copy { width: min(100%, 500px); margin: auto; }
.welcome-copy h2 { color: var(--text-primary); font-size: 25px; letter-spacing: -.025em; line-height: 1.25; margin-bottom: 12px; }
.welcome-copy p { font-size: var(--type-body); color: var(--text-muted); max-width: 47ch; }
.welcome-hint { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 40px; font-size: 11px; color: var(--text-faint); }
.notice { font-size: var(--type-meta); }
#back-sessions { display: none; }
@media (max-width: 719px) {
  .app-header { height: 44px; min-height: 44px; padding: 0 8px; gap: 8px; }
  .brand-app { flex: none; padding: 0; background: transparent; }
  .brand-app img { width: 20px; height: 20px; }
  .brand-app strong { font-size: 13px; }
  .remote-badge, .header-location { display: none; }
  .app-brand { flex: 1; }
  .network-status { font-size: 11px; }
  .app-content { display: flex; }
  .session-sidebar { width: 100%; flex: 1; border: 0; padding: 12px 10px 0; }
  .app-view[data-view="sessions"][data-detail="true"] .session-sidebar,
  .app-view:not([data-view="sessions"]) .session-sidebar { display: none; }
  .app-view[data-view="sessions"][data-detail="false"] .sessions-view { display: none; }
  .app-view[data-view="sessions"][data-detail="true"] #back-sessions,
  .app-view:not([data-view="sessions"]) #back-sessions { display: flex; order: -1; }
  .sidebar-tools .new-session { height: 32px; min-height: 32px; }
  .search-field { min-height: 36px; }
  .search-field input { font-size: 16px; min-height: 34px; }
  .folder-toggle { min-height: 34px; }
  .session-row { min-height: 42px; padding-block: 7px; }
  .sidebar-quota { max-height: 28%; }
  .content-view { padding: 24px 18px; }
  .content-view input, .content-view select { font-size: 16px; }
  #split-terminal span { display: none; }
  #split-terminal { min-width: 34px; min-height: 34px; }
  .web-terminal-body { padding: 6px; }
  .web-terminal-status { font-size: 10px; }
}
`;

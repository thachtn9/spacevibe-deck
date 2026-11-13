// Static regular-weight paths from @phosphor-icons/react (MIT); the phone needs no component runtime.
const iconPaths = {
  X: "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z",
  ArrowElbowDownLeft:
    "M200,32V176a8,8,0,0,1-8,8H67.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,11.32L67.31,168H184V32a8,8,0,0,1,16,0Z",
  DotsThree:
    "M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm56-12a12,12,0,1,0,12,12A12,12,0,0,0,196,116ZM60,116a12,12,0,1,0,12,12A12,12,0,0,0,60,116Z",
  Terminal:
    "M117.31,134l-72,64a8,8,0,1,1-10.63-12L100,128,34.69,70A8,8,0,1,1,45.32,58l72,64a8,8,0,0,1,0,12ZM216,184H120a8,8,0,0,0,0,16h96a8,8,0,0,0,0-16Z",
  ChartBar:
    "M224,200h-8V40a8,8,0,0,0-8-8H152a8,8,0,0,0-8,8V80H96a8,8,0,0,0-8,8v40H48a8,8,0,0,0-8,8v64H32a8,8,0,0,0,0,16H224a8,8,0,0,0,0-16ZM160,48h40V200H160ZM104,96h40V200H104ZM56,144H88v56H56Z",
  MagnifyingGlass:
    "M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z",
  Folder:
    "M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40ZM216,200H40V88H216Z",
  CaretRight:
    "M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z",
  ArrowLeft:
    "M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z",
  Plus: "M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z",
  ArrowClockwise:
    "M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16H211.4L184.81,71.64l-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,0,1,11,11.63A95.44,95.44,0,0,1,128,224h-1.32A96,96,0,1,1,195.75,60L224,85.8V56a8,8,0,1,1,16,0Z",
};
const icon = (name: keyof typeof iconPaths, size = 20) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"><use href="#remote-${name}"></use></svg>`;
const symbols = Object.entries(iconPaths)
  .map(
    ([name, d]) =>
      `<symbol id="remote-${name}" viewBox="0 0 256 256"><path d="${d}"></path></symbol>`,
  )
  .join("");

export const remoteWebPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#141414">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Deck Remote">
  <title>Deck Remote</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/xterm.css">
  <link rel="stylesheet" href="/remote.css">
  <script src="/xterm.js" defer></script>
  <script src="/fit.js" defer></script>
  <script src="/unicode.js" defer></script>
  <script src="/webgl.js" defer></script>
  <script src="/terminal.js" defer></script>
  <script src="/remote.js" defer></script>
</head>
<body>
  <svg class="icon-definitions" width="0" height="0" aria-hidden="true" focusable="false"><defs>${symbols}</defs></svg>
  <main id="pair-view" class="pair-view">
    <img class="app-icon" src="/icon.svg" alt="" width="64" height="64">
    <h1>Deck Remote</h1>
    <p class="pair-description">Your computer's sessions, within reach.</p>
    <form id="pair-form" class="pair-form">
      <label for="connection">Connection from Deck</label>
      <input id="connection" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Paste your connection or pairing key" required>
      <label class="check"><input id="remember" type="checkbox" checked>Remember this device</label>
      <button id="connect" class="primary" type="submit">Connect to computer</button>
      <p id="pair-error" class="notice error" role="alert" hidden></p>
    </form>
    <details class="setup-notes">
      <summary>Connection help</summary>
      <div>
        <h2>Connect from your computer</h2>
        <p>Open Deck Settings → Remote, enable access and copy the web link. Keep both devices on the same Wi-Fi or Tailscale network.</p>
        <h2>Keep it on your iPhone</h2>
        <p>In Safari, open Share → Add to Home Screen.</p>
      </div>
    </details>
    <p class="disclosure">Deck's always-on desktop usage analytics remain enabled.</p>
    <noscript>Enable JavaScript in Safari to connect to Deck.</noscript>
  </main>
  <div id="app-view" class="app-view" hidden>
    <header class="app-header">
      <div class="brand-app"><img src="/icon.svg" width="22" height="22" alt=""><strong>Deck</strong><span class="remote-badge">Remote</span></div>
      <button id="back-sessions" class="icon-button quiet" type="button" aria-label="All sessions" title="All sessions">${icon("ArrowLeft", 16)}</button>
      <div class="header-location">${icon("Folder", 15)}<span id="workspace-folder">Workspace</span><span class="breadcrumb-divider">/</span><span id="workspace-session">Sessions</span></div>
      <div class="app-brand"><h1 id="computer" class="sr-only">Connecting…</h1><div id="network-status" class="network-status" role="status"><span id="network-label">Connecting…</span><span id="network-time" class="sr-only"></span></div></div>
      <button id="split-terminal" class="quiet" type="button" aria-label="Split view" aria-pressed="false" title="Show or hide a second terminal" disabled hidden>${icon("Terminal", 16)}<span>Split</span></button>
      <details id="remote-menu" class="connection-menu">
        <summary aria-label="Connection menu" title="Connection menu">${icon("DotsThree", 20)}</summary>
        <div class="menu-content">
          <label class="check"><input id="follow" type="checkbox" checked>Follow output</label>
          <button id="disconnect" class="quiet" type="button">Disconnect</button>
        </div>
      </details>
    </header>
    <p id="app-error" class="notice error" role="alert" hidden></p>
    <main class="app-content">
      <aside id="session-sidebar" class="session-sidebar" aria-label="Running sessions">
        <div class="sidebar-tools"><button id="new-session" class="new-session" type="button" title="Open a folder and start a session">${icon("Plus", 14)}<span>Folder</span></button><span id="session-count" class="count">0</span><span class="sr-only">running sessions</span></div>
        <label class="search-field" for="search">${icon("MagnifyingGlass", 14)}<span class="sr-only">Search sessions</span><input id="search" type="search" placeholder="Find a session…" autocomplete="off"></label>
        <div id="session-list" class="session-list" aria-busy="true"></div>
        <section class="sidebar-quota" aria-label="Codex remaining quota"><div class="sidebar-quota-heading"><strong>Quota</strong><span>Remaining</span></div><p id="rail-quota-status" class="quota-note">Loading accounts…</p><div id="rail-quota-list"></div></section>
        <nav class="sidebar-footer main-nav" aria-label="Main navigation"><button id="nav-sessions" class="quiet" type="button" aria-pressed="true" title="Sessions">${icon("Terminal", 16)}<span>Sessions</span></button><button id="nav-quota" class="quiet" type="button" aria-pressed="false" title="Account quota">${icon("ChartBar", 16)}<span>Quota</span></button></nav>
      </aside>
      <section id="sessions-view" class="sessions-view">

        <section id="session-detail" class="session-detail" aria-label="Session" hidden>
          <div class="sr-only"><h2 id="session-title"></h2><span id="session-state" class="status-badge"></span><p id="session-meta"></p><p id="session-path"></p></div>
          <div id="web-terminals" class="web-terminals" aria-label="Interactive terminals"></div>
          <div class="terminal-panel" hidden>
            <p id="screen-status" class="screen-status" role="status">Reading screen…</p>
            <pre id="screen" class="terminal-screen" tabindex="0" aria-label="Live terminal output" aria-describedby="session-title session-meta session-path"></pre>
          </div>
          <form id="input-form" class="composer" hidden>
            <label class="sr-only" for="instruction">Command or instruction</label>
            <div class="composer-field">
              <textarea id="instruction" rows="1" placeholder="Type a command…" autocapitalize="none" autocomplete="off" spellcheck="false" aria-describedby="input-note"></textarea>
              <button id="send" class="primary icon-button" type="submit" aria-label="Send" title="Send" disabled>${icon("ArrowElbowDownLeft", 18)}</button>
            </div>
            <div class="composer-feedback"><p id="input-note" class="input-note" role="status"></p><button id="edit-input" class="quiet" type="button" hidden>Edit draft</button></div>
          </form>
        </section>
        <div id="select-session" class="select-session"><div class="welcome-copy"><h2>Your workspace, from anywhere.</h2><p>Open a running session from the sidebar, or choose a folder to start something new.</p></div><div class="welcome-hint">${icon("Terminal", 18)}<span>Your terminals. Your tools. Connected to your computer.</span></div></div>
      </section>
      <section id="quota-view" class="content-view" hidden>
        <div class="section-heading"><div><h2>Quota</h2><p class="section-description">Remaining allowance from CLI Manager.</p></div><button id="refresh-quota" type="button">${icon("ArrowClockwise")}<span>Refresh</span></button></div>
        <p id="quota-status" class="view-status" role="status">Loading quota…</p>
        <div id="quota-list"></div>
      </section>
      <section id="new-view" class="content-view" hidden>
        <div class="section-heading"><div><h2>New session</h2><p class="section-description">Choose a folder on your computer.</p></div><button id="cancel-new" class="quiet" type="button">Cancel</button></div>
        <div class="folder-heading"><button id="folder-up" type="button" disabled>${icon("ArrowLeft")}<span>Parent folder</span></button><p id="folder-path"></p></div>
        <div id="folder-list" class="folder-list" aria-label="Computer folders"></div>
        <form id="folder-create-form" class="folder-create-form">
          <label class="sr-only" for="folder-name">New folder name</label>
          <input id="folder-name" placeholder="New folder name" maxlength="128" required autocomplete="off">
          <button id="create-folder" type="submit">Create folder</button>
        </form>
        <p id="folder-note" class="view-status" role="status"></p>
        <form id="create-form" class="create-form">
          <div class="launch-options">
            <div class="field"><label for="agent">Agent</label><select id="agent"><option value="codex">Codex</option><option value="agy">AGY</option><option value="">Shell</option></select></div>
            <div class="field"><label for="account">Account</label><select id="account"><option value="">Default account</option></select></div>
          </div>
          <p id="create-note" class="view-status" role="status"></p>
          <button id="create" class="primary" type="submit" disabled>Start session here</button>
          <button id="edit-create" type="button" hidden>Choose again</button>
        </form>
      </section>
    </main>
  </div>
</body>
</html>`;

export const remoteWebIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="40" fill="#141414"/><g fill="none" stroke="#cbcbcb" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><rect x="34" y="42" width="124" height="108" rx="8"/><path d="M34 70h124M55 94l17 14-17 14m37 0h30"/></g></svg>`;

export const remoteWebManifest = JSON.stringify({
  id: "/",
  name: "Deck Remote",
  short_name: "Deck",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#0a0a0a",
  theme_color: "#141414",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
});

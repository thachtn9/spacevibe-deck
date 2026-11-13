# Linux baseline

> For maintainers. This checkout ports upstream Deck 2.10.0 to Linux x86_64.

## Setup

Use Node.js 22 or newer and npm. On Ubuntu/Debian, install native build tools first:

```sh
sudo apt install build-essential python3 pkg-config libnss3 libnotify4 libxtst6 libsecret-1-0 xdg-utils lsof
npm ci
npm run build:linux
npm start
```

Electron also needs GTK 3 and AT-SPI. These normally come with the desktop; package names
are `libgtk-3-0` / `libatspi2.0-0`, or their `t64` variants on newer Ubuntu releases.
The Electron build does not require Rust. `build:linux` deliberately skips the Tauri menu
generator; upstream `build` and `dev` commands remain available.

For live renderer development, run `npm run electron:dev`.
To open the desktop app independently of the launching terminal, run
`npm start -- --background` (add `--no-sandbox` only when needed as described below).
This returns the prompt immediately and writes logs to
`${XDG_STATE_HOME:-$HOME/.local/state}/spacevibe-deck/dev.log`.
In foreground mode, Ctrl+Z suspends the entire application and the desktop may report
it as unresponsive; use `fg` in that same terminal to resume it.
After a native-module ABI error, run
`npx electron-builder install-app-deps --config electron-builder.linux.yml` and rebuild.

## iOS companion

Build or run the Electron host with these sources, then open Settings → Remote. Choose the
shared folder, enable remote access and select an address reachable from the iPhone.
The default port is 43189. Keep both devices on the same trusted LAN or Tailscale network.
Use the computer's LAN or Tailscale address, rather than `127.0.0.1`. If a local firewall
blocks the connection, allow TCP on that port from the selected private network.

### Safari: no Mac required

Choose Copy web link and open that link in Safari on the iPhone. Tap Connect to computer,
then use Safari's Share → Add to Home Screen to keep Deck Remote alongside other apps.
The phone may ask for the copied connection again when first opened from the Home Screen;
paste the same web link into Connection from Deck. Remember this device retains the key in
that browser's local storage. Disconnect removes it from the current browser.

The browser app is served by Deck itself, without another web server or build command.
It has Sessions and Quota tabs. Open a session to read its screen and send text; an empty
composer offers Enter. New session browses the computer's shared folder and opens a new
Shell, Codex or AGY tab, optionally under a selected account. Drafts stay with each session
while the page is open. A failed send offers an explicit retry; reconnect never resends it.
Safari suspends polling in the background. Work keeps running on the computer.

Treat either copied connection as a credential. Reset pairing revokes it. Keep Deck and the
computer running while using either client. The default HTTP endpoint is for a trusted LAN
or encrypted private network; do not forward its port to the public internet.

### Optional native app

The native app is `ios/DeckRemote.xcodeproj`, targeting iOS 17 or newer with no package
dependencies. On a Mac with Xcode, open the project, select the DeckRemote scheme and an
iPhone Simulator, then Run. To install on a physical iPhone, select your signing team and
device in Xcode. Choose Copy connection in Deck and paste it into the native app.
An unsigned Simulator build can be checked with:

```sh
xcodebuild -project ios/DeckRemote.xcodeproj -scheme DeckRemote \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

iOS compilation, signing and Simulator/device checks require macOS; Linux checks cover
gateway and web behavior, Swift syntax and project-file structure only.

## Local packages

```sh
npm run electron:package:linux
```

Outputs in `dist-electron-linux/` include an AppImage, a `.deb`, and `linux-unpacked/`.
Install the Debian package with `sudo apt install ./dist-electron-linux/*.deb`, or make the
AppImage executable and launch it. If FUSE is unavailable, launch the AppImage with
`--appimage-extract-and-run`.

Ubuntu's AppArmor policy can prevent an unpackaged Electron binary from creating its
sandbox. If a development launch stops with the `chrome-sandbox` ownership error, use
`npm start -- --no-sandbox` for local development. This explicitly disables Chromium's
process sandbox; it is not baked into the packaged application. The Debian installer
configures its bundled sandbox helper during installation.

## Platform behavior

Linux uses Ctrl shortcuts, native window controls in Deck's header, login-shell PTYs and
`/proc` cwd discovery. Existing agent adapters, session restore, usage views, files and
browser tabs come from upstream. Missing agents link to their vendor's setup page when
no Linux installer command has been verified. CLI tools and their authentication are
installed separately.

Closing Deck preserves its live terminals in a background service. Reopening reconnects those
PTYs and restores tabs and split layouts. After reboot, recorded Codex/AGY session identities
resume under the same account; an unverified identity leaves a shell with a Session History
notice. Close an individual terminal or tab to end that work explicitly. Existing terminals
started by older builds cannot be transferred into the new service.

The first port does not change upstream's analytics behavior or launch commands. Linux
auto-update is disabled because upstream publishes no Linux manifest; these are local
builds, not upstream releases. No release is published by the packaging command.

The basic platform/keymap/updater changes were informed by the MIT-licensed community
port at https://github.com/chibaole930-max/spacevibe-deck-linux. This checkout uses upstream
2.10.0 directly and additionally provides Linux cwd discovery and window controls.

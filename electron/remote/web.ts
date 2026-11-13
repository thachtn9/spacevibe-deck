import { createWebTerminal } from "./web-terminal";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bootRemoteWeb } from "./web-client";
import { remoteWebIcon, remoteWebManifest, remoteWebPage } from "./web-page";
import { remoteWebStyle } from "./web-style";

const assets: ReadonlyMap<string, { type: string; body: string }> = new Map([
  [
    "/terminal.js",
    {
      type: "text/javascript; charset=utf-8",
      body: `window.createDeckTerminal = ${createWebTerminal.toString()};`,
    },
  ],
  ["/", { type: "text/html; charset=utf-8", body: remoteWebPage }],
  ["/remote.css", { type: "text/css; charset=utf-8", body: remoteWebStyle }],
  // Let the existing TypeScript build carry this dependency-free client on both dev and release.
  [
    "/remote.js",
    { type: "text/javascript; charset=utf-8", body: `(${bootRemoteWeb.toString()})();` },
  ],
  ["/manifest.webmanifest", { type: "application/manifest+json", body: remoteWebManifest }],
  ["/icon.svg", { type: "image/svg+xml", body: remoteWebIcon }],
]);

export function remoteWebAsset(path: string) {
  const asset = assets.get(path);
  if (asset) return asset;
  const name = {
    "/xterm.js": "xterm.js",
    "/xterm.css": "xterm.css",
    "/fit.js": "fit.js",
    "/unicode.js": "unicode.js",
    "/webgl.js": "webgl.js",
  }[path];
  if (!name) return undefined;
  const file = join(__dirname, "../vendor/remote", name);
  if (!existsSync(file)) return undefined;
  return {
    type: name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
    body: readFileSync(file, "utf8"),
  };
}

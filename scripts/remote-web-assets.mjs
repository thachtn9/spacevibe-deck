import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

/** Copy installed xterm browser distributions into the host's packaged vendor map. */
export function copyRemoteWebAssets(root, output) {
  const require = createRequire(join(root, "package.json"));
  const target = join(output, "electron", "vendor", "remote");
  mkdirSync(target, { recursive: true });
  for (const [source, destination] of [
    [require.resolve("@xterm/xterm"), "xterm.js"],
    [join(dirname(require.resolve("@xterm/xterm")), "../css/xterm.css"), "xterm.css"],
    [require.resolve("@xterm/addon-fit"), "fit.js"],
    [require.resolve("@xterm/addon-unicode-graphemes"), "unicode.js"],
    [require.resolve("@xterm/addon-webgl"), "webgl.js"],
  ])
    copyFileSync(source, join(target, destination));
}

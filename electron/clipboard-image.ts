import { app, clipboard } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Keep attachments across UI restarts: a detached agent may still reference them. */
export async function readClipboardImage(): Promise<string | null> {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const png = image.toPNG();
  if (png.length > 20 * 1024 * 1024) throw new Error("Clipboard image is too large (max 20 MB)");
  const directory = path.join(app.getPath("userData"), "clipboard-images");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${randomUUID()}.png`);
  await fs.writeFile(target, png, { mode: 0o600, flag: "wx" });
  return target;
}

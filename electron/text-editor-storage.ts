import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, mkdir, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { TextWorkspace } from "../src/files/text-editor-types";

export const TEXT_LIMIT = 8 * 1024 * 1024;
export const fingerprint = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export async function readText(file: string) {
  const canonical = await realpath(file);
  const handle = await open(canonical, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > TEXT_LIMIT)
      throw new Error("Choose a text file smaller than 8 MB.");
    const bytes = Buffer.alloc(TEXT_LIMIT + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const data = bytes.subarray(0, bytesRead);
    if (bytesRead > TEXT_LIMIT || data.includes(0))
      throw new Error("This file is too large or contains binary data.");
    // Keep the BOM in the document so saving preserves the original UTF-8 bytes.
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    return {
      path: canonical,
      name: path.basename(canonical),
      content,
      fingerprint: fingerprint(data),
    };
  } finally {
    await handle.close();
  }
}
export function validateWorkspace(value: unknown): TextWorkspace {
  const state = value as TextWorkspace;
  if (
    !state ||
    state.version !== 1 ||
    !Array.isArray(state.documents) ||
    state.documents.length > 100 ||
    typeof state.wrap !== "boolean" ||
    !Number.isFinite(state.fontSize) ||
    state.fontSize < 10 ||
    state.fontSize > 32 ||
    (state.active !== null && typeof state.active !== "string")
  )
    throw new Error("Invalid editor workspace.");
  const ids = new Set<string>();
  for (const doc of state.documents) {
    if (
      !doc ||
      typeof doc.id !== "string" ||
      ids.has(doc.id) ||
      typeof doc.name !== "string" ||
      typeof doc.content !== "string" ||
      typeof doc.savedContent !== "string" ||
      (doc.path !== null && (typeof doc.path !== "string" || !path.isAbsolute(doc.path))) ||
      (doc.fingerprint !== null && typeof doc.fingerprint !== "string") ||
      Buffer.byteLength(doc.content) > TEXT_LIMIT ||
      Buffer.byteLength(doc.savedContent) > TEXT_LIMIT
    )
      throw new Error("Invalid document or document exceeds 8 MB.");
    ids.add(doc.id);
  }
  if (state.active !== null && !ids.has(state.active)) throw new Error("Invalid active document.");
  return state;
}
export async function atomicSnapshot(file: string, state: TextWorkspace): Promise<void> {
  validateWorkspace(state);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export async function loadSnapshot(file: string): Promise<TextWorkspace> {
  try {
    return validateWorkspace(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, active: null, documents: [], wrap: true, fontSize: 14 };
    throw new Error(
      "Couldn't read saved notes. The saved workspace was kept intact. Close this window and check the workspace file.",
    );
  }
}

export async function saveText(
  target: string,
  content: string,
  expected: string | null,
): Promise<string> {
  if (typeof content !== "string" || Buffer.byteLength(content) > TEXT_LIMIT)
    throw new Error("Documents must be smaller than 8 MB.");
  const handle = await open(target, expected === null ? "wx" : "r+");
  try {
    const current = expected === null ? null : await handle.readFile();
    if (expected !== null && current !== null && fingerprint(current) !== expected)
      throw new Error(
        "This file changed outside Text Editor. Use Save As to keep your version, or reopen the file.",
      );
    const bytes = Buffer.from(content, "utf8");
    let written = 0;
    while (written < bytes.length) {
      const result = await handle.write(bytes, written, bytes.length - written, written);
      if (!result.bytesWritten) throw new Error("Couldn't finish writing the file.");
      written += result.bytesWritten;
    }
    await handle.truncate(bytes.length);
    await handle.sync();
    return fingerprint(bytes);
  } finally {
    await handle.close();
  }
}

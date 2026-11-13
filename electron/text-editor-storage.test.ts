import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  atomicSnapshot,
  loadSnapshot,
  readText,
  saveText,
  TEXT_LIMIT,
} from "./text-editor-storage";

const directories: string[] = [];
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "deck-editor-"));
  directories.push(dir);
  return path.join(dir, "note.txt");
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe("Text Editor local storage", () => {
  it("creates a new file for Save As and refuses to overwrite a newly appeared file", async () => {
    const file = await fixture();
    await saveText(file, "New note tiếng Việt", null);
    expect(await readFile(file, "utf8")).toBe("New note tiếng Việt");
    await expect(saveText(file, "overwrite", null)).rejects.toThrow(/EEXIST/);
    expect(await readFile(file, "utf8")).toBe("New note tiếng Việt");
  });

  it("preserves UTF-8 BOM, Vietnamese and CRLF when opening and saving", async () => {
    const file = await fixture();
    const text = "\ufeffGhi chú tiếng Việt\r\nDòng thứ hai\r\n";
    await writeFile(file, text);
    const loaded = await readText(file);
    expect(loaded.content).toBe(text);
    await saveText(file, loaded.content, loaded.fingerprint);
    expect(await readFile(file, "utf8")).toBe(text);
    await saveText(file, "", loaded.fingerprint);
    expect(await readFile(file, "utf8")).toBe("");
  });
  it("refuses an external modification without changing its bytes", async () => {
    const file = await fixture();
    await writeFile(file, "original");
    const loaded = await readText(file);
    await writeFile(file, "external change");
    await expect(saveText(file, "my draft", loaded.fingerprint)).rejects.toThrow("changed outside");
    expect(await readFile(file, "utf8")).toBe("external change");
  });
  it("refuses binary, invalid UTF-8 and oversized files", async () => {
    const file = await fixture();
    for (const bytes of [
      Buffer.from([1, 0, 2]),
      Buffer.from([0xff]),
      Buffer.alloc(TEXT_LIMIT + 1, 65),
    ]) {
      await writeFile(file, bytes);
      await expect(readText(file)).rejects.toThrow(/binary|smaller|valid/);
    }
  });
  it("restores notes and dirty file drafts from a private atomic snapshot", async () => {
    const file = await fixture();
    const state = {
      version: 1 as const,
      active: "note",
      documents: [
        {
          id: "note",
          path: null,
          name: "Ideas",
          content: "Ghi chú",
          savedContent: "",
          fingerprint: null,
        },
      ],
      wrap: true,
      fontSize: 14,
    };
    await atomicSnapshot(file, state);
    expect(await loadSnapshot(file)).toEqual(state);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(atomicSnapshot(file, { ...state, active: "missing" })).rejects.toThrow(
      "Invalid active document",
    );
    expect(await loadSnapshot(file)).toEqual(state);
  });
  it("keeps corrupt saved data intact instead of silently replacing it", async () => {
    const file = await fixture();
    await writeFile(file, "{broken");
    await expect(loadSnapshot(file)).rejects.toThrow("kept intact");
    expect(await readFile(file, "utf8")).toBe("{broken");
  });
});

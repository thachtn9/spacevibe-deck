import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readClipboardImage } from "./clipboard-image";

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  isEmpty: vi.fn(),
  toPNG: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: mocks.getPath },
  clipboard: { readImage: () => ({ isEmpty: mocks.isEmpty, toPNG: mocks.toPNG }) },
}));

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-image-test-"));
  mocks.getPath.mockReturnValue(directory);
  mocks.isEmpty.mockReturnValue(false);
  mocks.toPNG.mockReturnValue(Buffer.from("clipboard PNG"));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

it("leaves text-only clipboards alone without creating files", async () => {
  mocks.isEmpty.mockReturnValue(true);
  expect(await readClipboardImage()).toBeNull();
  expect(await fs.readdir(directory)).toEqual([]);
});

it("saves private, unique PNG attachments that survive a later paste", async () => {
  const first = (await readClipboardImage())!;
  mocks.toPNG.mockReturnValue(Buffer.from("next PNG"));
  const second = (await readClipboardImage())!;
  expect(first).not.toBe(second);
  expect(await fs.readFile(first, "utf8")).toBe("clipboard PNG");
  expect(await fs.readFile(second, "utf8")).toBe("next PNG");
  expect(path.dirname(first)).toBe(path.join(directory, "clipboard-images"));
  if (process.platform !== "win32") {
    expect((await fs.stat(first)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(first))).mode & 0o777).toBe(0o700);
  }
});

it("rejects oversized images without writing a partial attachment", async () => {
  mocks.toPNG.mockReturnValue(Buffer.alloc(20 * 1024 * 1024 + 1));
  await expect(readClipboardImage()).rejects.toThrow("20 MB");
  expect(await fs.readdir(directory)).toEqual([]);
});

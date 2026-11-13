import { BrowserWindow, WebContentsView, ipcMain, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ReviewAnnotation,
  ReviewProject,
  ReviewRect,
  ReviewSnapshot,
} from "../../src/lib/web-review";
import { reviewInjection } from "./inject";
import { validateReviewCapture } from "./capture";
import type { ReviewStorage } from "./storage";

const exec = promisify(execFile);
const EMPTY_PAGE = {
  url: "",
  title: "",
  loading: false,
  error: null as string | null,
  mode: "browse",
};

export class ReviewWindow {
  private window: BrowserWindow | null = null;
  private guest: WebContentsView | null = null;
  private projectId: string | null = null;
  private opening: Promise<void> | null = null;
  private generation = 0;
  private capturing = false;
  private bounds: ReviewRect = { x: 0, y: 90, width: 800, height: 600 };
  private page = { ...EMPTY_PAGE };

  constructor(
    private readonly deps: {
      storage: ReviewStorage;
      preload: string;
      pagePreload: string;
      rendererUrl: string;
      snapshot(project: ReviewProject): Pick<ReviewSnapshot, "targets" | "theme">;
    },
  ) {
    ipcMain.on("web-review:capture", (event, raw: unknown) => {
      if (
        event.sender !== this.guest?.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        this.page.mode === "browse" ||
        this.capturing ||
        typeof raw !== "string" ||
        raw.length > 24_000
      )
        return;
      void this.capture(raw).catch((error: unknown) => this.fail(error));
    });
    ipcMain.on("web-review:cancel", (event) => {
      if (event.sender === this.guest?.webContents) {
        this.page.mode = "browse";
        this.changed();
      }
    });
  }

  assert(event: IpcMainInvokeEvent): ReviewProject {
    if (
      !this.window ||
      event.sender !== this.window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      !this.projectId
    )
      throw new Error("Web Review window required.");
    return this.deps.storage.project(this.projectId);
  }

  state(): ReviewSnapshot | null {
    if (!this.projectId) return null;
    const project = this.deps.storage.project(this.projectId);
    return { project, page: this.page, ...this.deps.snapshot(project) };
  }

  changed(): void {
    if (this.window && !this.window.isDestroyed())
      this.window.webContents.send("web-review:state", this.state());
  }

  fail(error: unknown): void {
    this.page = {
      ...this.page,
      error: error instanceof Error ? error.message : "Web Review could not complete that action.",
    };
    this.changed();
  }

  async open(project: ReviewProject, configure: boolean): Promise<void> {
    if (this.opening) await this.opening;
    if (this.projectId !== project.id) {
      this.destroyGuest();
      this.projectId = project.id;
      this.page = { ...EMPTY_PAGE };
    }
    if (!this.window || this.window.isDestroyed()) {
      const win = new BrowserWindow({
        title: "Browser Extension — Deck",
        width: 680,
        height: 640,
        minWidth: 520,
        minHeight: 460,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: "#0a0a0a",
        webPreferences: {
          preload: this.deps.preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          additionalArguments: ["--deck-web-review"],
        },
      });
      this.window = win;
      win.setMenu(null);
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      let closing = false;
      win.on("close", (event) => {
        if (closing) return;
        event.preventDefault();
        void this.deps.storage
          .flush()
          .then(() => {
            closing = true;
            win.close();
          })
          .catch((error) => this.fail(error));
      });
      win.on("closed", () => {
        this.destroyGuest();
        this.window = null;
      });
      this.opening = win.loadURL(this.deps.rendererUrl).then(() => {
        win.show();
      });
      try {
        await this.opening;
      } catch (error) {
        win.destroy();
        throw error;
      } finally {
        this.opening = null;
      }
    }
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    // Browser review now runs in Chrome; this window only pairs the extension.
    this.changed();
    if (configure) this.window.webContents.send("web-review:configure", {});
  }

  setBounds(value: ReviewRect): void {
    if (
      !this.window ||
      !value ||
      ![value.x, value.y, value.width, value.height].every(Number.isFinite)
    )
      return;
    const [width, height] = this.window.getContentSize();
    const x = Math.max(0, Math.min(width, Math.round(value.x)));
    const y = Math.max(0, Math.min(height, Math.round(value.y)));
    this.bounds = {
      x,
      y,
      width: Math.max(0, Math.min(width - x, Math.round(value.width))),
      height: Math.max(0, Math.min(height - y, Math.round(value.height))),
    };
    this.guest?.setBounds(this.bounds);
    this.guest?.setVisible(this.bounds.width > 0 && this.bounds.height > 0);
  }

  async navigate(url?: string, action?: string): Promise<void> {
    if (!this.window || !this.projectId) return;
    const project = this.deps.storage.project(this.projectId);
    if (!project.url) return;
    if (!this.guest) {
      const guest = new WebContentsView({
        webPreferences: {
          preload: this.deps.pagePreload,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: `persist:deck-review-${project.id}`,
        },
      });
      this.guest = guest;
      this.window.contentView.addChildView(guest);
      guest.setBounds(this.bounds);
      const wc = guest.webContents;
      wc.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      );
      wc.session.setPermissionCheckHandler(() => false);
      wc.setWindowOpenHandler(({ url: next }) => {
        if (new URL(next).origin === new URL(this.deps.storage.project(this.projectId!).url).origin)
          void this.navigate(next).catch((e: unknown) => this.fail(e));
        else this.fail(new Error("Open external links in your normal browser."));
        return { action: "deny" };
      });
      wc.on("will-navigate", (event, next) => {
        if (!/^https?:\/\//i.test(next)) event.preventDefault();
      });
      wc.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) {
          this.generation++;
          this.page.mode = "browse";
        }
      });
      wc.on("did-start-loading", () => {
        this.page.loading = true;
        this.page.error = null;
        this.changed();
      });
      wc.on("did-stop-loading", () => {
        this.page.loading = false;
        this.updatePage();
      });
      wc.on("did-navigate-in-page", () => {
        this.page.mode = "browse";
        void this.script("window.__deckReview?.setMode('browse')");
        this.updatePage();
        this.pins();
      });
      wc.on("page-title-updated", () => this.updatePage());
      wc.on("did-finish-load", () => {
        this.updatePage();
        if (
          new URL(wc.getURL()).origin !==
          new URL(this.deps.storage.project(this.projectId!).url).origin
        )
          return;
        const theme = this.deps.snapshot(project).theme;
        void wc
          .executeJavaScript(reviewInjection(theme.blue))
          .then(() => this.pins())
          .catch((e: unknown) => this.fail(e));
      });
      wc.on("did-fail-load", (_event, code, message, _url, mainFrame) => {
        if (mainFrame && code !== -3) {
          this.page.loading = false;
          this.fail(
            new Error(
              `Could not load this web app (${message}). Start its dev server, then reload.`,
            ),
          );
        }
      });
      wc.on("render-process-gone", () =>
        this.fail(new Error("The web page stopped. Reload to try again.")),
      );
    }
    if (action === "back") {
      if (this.guest.webContents.navigationHistory.canGoBack())
        this.guest.webContents.navigationHistory.goBack();
    } else if (action === "forward") {
      if (this.guest.webContents.navigationHistory.canGoForward())
        this.guest.webContents.navigationHistory.goForward();
    } else if (action === "reload") this.guest.webContents.reload();
    else await this.guest.webContents.loadURL(url ?? project.url).catch(() => {});
  }

  async mode(mode: string): Promise<void> {
    if (!["browse", "element", "region"].includes(mode) || !this.guest || this.capturing) return;
    if (
      mode !== "browse" &&
      new URL(this.guest.webContents.getURL()).origin !==
        new URL(this.deps.storage.project(this.projectId!).url).origin
    )
      throw new Error("Return to this project's configured origin before annotating.");
    if (!(await this.script("Boolean(window.__deckReview)")))
      throw new Error("Wait for the page to finish loading, then try again.");
    await this.script(`window.__deckReview.setMode(${JSON.stringify(mode)})`);
    this.page.mode = mode;
    this.changed();
    this.guest.webContents.focus();
  }

  async reveal(annotation: ReviewAnnotation): Promise<void> {
    if (!this.guest) return;
    if (this.guest.webContents.getURL() !== annotation.capture.url) {
      await this.navigate(annotation.capture.url);
      this.fail(new Error("Page opened. Restore its tab or dialog, then select Locate again."));
      return;
    }
    const found = await this.script(
      `window.__deckReview?.reveal(${JSON.stringify(annotation.capture)})`,
    );
    if (!found)
      throw new Error(
        "The original element is not present. Use its saved screenshot, or restore the page state.",
      );
  }

  pins(): void {
    if (!this.projectId) return;
    const pins = this.deps.storage
      .project(this.projectId)
      .annotations.map((a, index) => ({
        ...a.capture,
        id: a.id,
        number: index + 1,
        reviewed: a.reviewed,
      }))
      .filter((a) => !a.reviewed);
    void this.script(`window.__deckReview?.setPins(${JSON.stringify(pins)})`).catch(() => {});
  }

  dispose(): void {
    this.destroyGuest();
    this.window?.destroy();
    this.window = null;
  }

  hasWindow(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  async closeForQuit(): Promise<void> {
    await this.deps.storage.flush();
    this.dispose();
  }

  private destroyGuest(): void {
    this.generation++;
    if (this.guest) {
      if (this.window && !this.window.isDestroyed())
        this.window.contentView.removeChildView(this.guest);
      if (!this.guest.webContents.isDestroyed()) this.guest.webContents.close();
      this.guest = null;
    }
  }
  private script(script: string): Promise<unknown> {
    return this.guest && !this.guest.webContents.isDestroyed()
      ? this.guest.webContents.executeJavaScript(script)
      : Promise.resolve(null);
  }
  private updatePage(): void {
    if (!this.guest) return;
    this.page.url = this.guest.webContents.getURL();
    this.page.title = this.guest.webContents.getTitle();
    this.changed();
  }

  private async capture(raw: string): Promise<void> {
    const guest = this.guest!,
      id = this.projectId!,
      generation = this.generation;
    const project = this.deps.storage.project(id);
    if (new URL(guest.webContents.getURL()).origin !== new URL(project.url).origin) return;
    const capture = validateReviewCapture(JSON.parse(raw), guest.webContents.getURL());
    this.capturing = true;
    try {
      const geometry = () =>
        guest.webContents.executeJavaScript(
          "JSON.stringify([location.href,innerWidth,innerHeight,scrollX,scrollY])",
        );
      const expected = JSON.stringify([
        capture.url,
        capture.viewport.width,
        capture.viewport.height,
        capture.viewport.scrollX,
        capture.viewport.scrollY,
      ]);
      if ((await geometry()) !== expected)
        throw new Error("The page moved. Select the element again.");
      const screen = await guest.webContents.capturePage();
      if (
        generation !== this.generation ||
        id !== this.projectId ||
        (await geometry()) !== expected
      )
        throw new Error("The page changed during capture. Select the element again.");
      const annotationId = randomUUID();
      const screenshot = this.deps.storage.imagePath(id, annotationId, "screen"),
        crop = this.deps.storage.imagePath(id, annotationId, "crop");
      const size = screen.getSize();
      if (screen.isEmpty()) throw new Error("Could not capture this page. Try again.");
      const scaleX = size.width / capture.viewport.width,
        scaleY = size.height / capture.viewport.height;
      const x = Math.floor(capture.rect.x * scaleX),
        y = Math.floor(capture.rect.y * scaleY);
      const clipped = screen.crop({
        x,
        y,
        width: Math.min(size.width - x, Math.max(1, Math.ceil(capture.rect.width * scaleX))),
        height: Math.min(size.height - y, Math.max(1, Math.ceil(capture.rect.height * scaleY))),
      });
      await this.deps.storage.atomic(screenshot, screen.toPNG());
      await this.deps.storage.atomic(crop, clipped.toPNG());
      const git = await Promise.all([
        exec("git", ["-C", project.root, "rev-parse", "--abbrev-ref", "HEAD"], {
          timeout: 2000,
          maxBuffer: 16384,
        }),
        exec("git", ["-C", project.root, "rev-parse", "HEAD"], { timeout: 2000, maxBuffer: 16384 }),
        exec("git", ["-C", project.root, "status", "--porcelain", "--untracked-files=no"], {
          timeout: 2000,
          maxBuffer: 65536,
        }),
      ])
        .then(([branch, commit, dirty]) => ({
          branch: branch.stdout.trim(),
          commit: commit.stdout.trim(),
          dirty: dirty.stdout.length > 0,
        }))
        .catch(() => null);
      await this.deps.storage.edit(id, (p) => {
        if (p.annotations.length >= 200)
          throw new Error(
            "This project has 200 comments. Remove older comments before adding more.",
          );
        p.annotations.push({
          id: annotationId,
          capture,
          comment: "",
          steps: "",
          screenshot,
          crop,
          git,
          reviewed: false,
        });
      });
      this.changed();
      this.pins();
      this.window?.webContents.send("web-review:selected", { id: annotationId });
      this.window?.webContents.focus();
    } finally {
      this.capturing = false;
      this.page.mode = "browse";
      this.changed();
      this.pins();
    }
  }
}

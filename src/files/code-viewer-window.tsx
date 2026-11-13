/* oxlint-disable react-hooks/exhaustive-deps -- The window lifecycle writes stable signals and owns one controller. */
import { render } from "preact";
import { useEffect } from "preact/hooks";
import { signal, useSignal, useSignalEffect } from "@preact/signals";
import {
  codeViewerState,
  listenCodeViewerOpen,
  openCodeViewer,
  type CodeViewerRequest,
} from "../host/code-viewer-host";
import { getCurrentWindow } from "../host/window-host";
import { initializeDesktopEnvironmentFromBackend } from "../lib/platform";
import { applyThemeVars } from "../lib/theme-vars";
import { initSettings, settings } from "../settings/settings-store";
import { loadCustomThemes } from "../settings/custom-themes-store";
import { resolveTheme } from "../settings/themes";
import {
  createFileSurfaceController,
  editorSettings,
  type FileSurfaceController,
} from "./file-surface-controller";
import { defaultFileClient } from "./file-client";
import { codeViewerRoot } from "./code-viewer-store";
import { setActiveWorkspace } from "./file-surface-store";
import { CodeViewer } from "./ui/code-viewer";

function ViewerWindow() {
  const error = useSignal("");
  useSignalEffect(() => {
    applyThemeVars(document.documentElement.style, resolveTheme(settings.value));
    editorSettings.value = settings.value;
  });
  useEffect(() => {
    let disposed = false;
    let latest = 0;
    let stop: (() => void) | undefined;
    const rejectWrite = async (): Promise<never> => {
      throw new Error("The code viewer is read only");
    };
    const controller = createFileSurfaceController({
      client: {
        ...defaultFileClient,
        writeFile: rejectWrite,
        createEntry: rejectWrite,
        setDirtyFiles: async () => {},
      },
    });
    viewerController.value = controller;
    const apply = (request: CodeViewerRequest) => {
      if (disposed || request.nonce <= latest) return;
      latest = request.nonce;
      codeViewerRoot.value = request.root;
      setActiveWorkspace(request.root);
      if (request.path)
        void controller
          .openFile(request.root, request.path, true, {
            line: request.line,
            column: request.column,
          })
          .catch((reason: unknown) => {
            error.value = String(reason);
          });
    };
    void (async () => {
      await controller.init();
      stop = await listenCodeViewerOpen(apply);
      if (disposed) {
        stop();
        return;
      }
      apply(await codeViewerState());
    })().catch((reason: unknown) => {
      if (!disposed) error.value = String(reason);
    });
    const focus = () => {
      void initSettings();
    };
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      stop?.();
      controller.dispose();
      window.removeEventListener("focus", focus);
    };
  }, []);
  const controller = viewerController.value;
  return (
    <main class="code-viewer-window">
      {error.value && <p role="alert">{error.value}</p>}
      {codeViewerRoot.value && controller ? (
        <CodeViewer
          root={codeViewerRoot.value}
          controller={controller}
          closeLabel="Close window"
          onClose={() => {
            void getCurrentWindow().close();
          }}
          onOpenFolder={(root) => openCodeViewer(root)}
        />
      ) : (
        <p role="status">Opening code viewer…</p>
      )}
    </main>
  );
}

// This entry never mounts App or a TabManager and never writes a terminal journal.
const viewerController = signal<FileSurfaceController | null>(null);

export async function mountCodeViewerWindow(): Promise<void> {
  await initializeDesktopEnvironmentFromBackend();
  await initSettings();
  await loadCustomThemes();
  const root = document.getElementById("root");
  if (!root) throw new Error("The code viewer root is missing");
  render(<ViewerWindow />, root);
}

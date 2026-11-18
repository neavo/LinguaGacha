import { randomUUID } from "node:crypto";
import path from "node:path";
import { BrowserWindow, session, type Session } from "electron";
import { default_native_fs as fs } from "./native-fs";
import { run_window_task } from "./window-task";
import type { ImageTextRenderStep } from "./image-text-renderer";
import { IMAGE_TEXT_RULES, type ImageTextHost, type ImageTextPaint } from "../shared/image-text";

const CSP =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/** 单页独占隔离窗口；排队取消立即结算，活动取消等待窗口实际回收。 */
export function create_image_text_host(resources: {
  fontsDirectory: string;
  workspaceRuntimeDirectory: string;
}): ImageTextHost & { dispose: () => Promise<void> } {
  let tail: Promise<unknown> = Promise.resolve();
  let browserSession: Session | undefined;
  let assets: { fontCss: string; script: string } | undefined;
  const lifetime = new AbortController();
  const host: ImageTextHost = async (operation, signal) => {
    const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    combined.throwIfAborted();
    if (!assets) {
      const font = fs.read_file(path.join(resources.fontsDirectory, IMAGE_TEXT_RULES.fontFile));
      const script = fs.read_text_file(
        path.join(resources.workspaceRuntimeDirectory, "runtime/image-text-renderer.js"),
      );
      assets = {
        fontCss: `@font-face{font-family:ImageText;src:url(data:font/ttf;base64,${font.toString("base64")}) format('truetype');font-weight:400;font-style:normal}`,
        script,
      };
    }
    const fixed = assets;
    const cancelled = Promise.withResolvers<never>();
    const cancelQueued = () => cancelled.reject(combined.reason);
    combined.addEventListener("abort", cancelQueued, { once: true });
    const result = tail.then(async () => {
      combined.removeEventListener("abort", cancelQueued);
      combined.throwIfAborted();
      if (!browserSession) {
        browserSession = session.fromPartition(`image-text-${randomUUID()}`, { cache: false });
        browserSession.webRequest.onBeforeRequest((details, callback) =>
          callback({ cancel: !details.url.startsWith("data:") }),
        );
        browserSession.setPermissionRequestHandler((_contents, _permission, callback) =>
          callback(false),
        );
      }
      const window = new BrowserWindow({
        show: false,
        transparent: true,
        backgroundColor: "#00000000",
        webPreferences: {
          session: browserSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          offscreen: true,
          backgroundThrottling: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      return run_window_task(window, combined, IMAGE_TEXT_RULES.pageTimeoutMs, async (step) => {
        await step("load", () =>
          window.loadURL(
            `data:text/html,${encodeURIComponent(`<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}">`)}`,
          ),
        );
        const debuggerPort = window.webContents.debugger;
        debuggerPort.attach("1.3");
        await step("transparent", () =>
          debuggerPort.sendCommand("Emulation.setDefaultBackgroundColorOverride", {
            color: { r: 0, g: 0, b: 0, a: 0 },
          }),
        );
        await step("renderer", () =>
          window.webContents.executeJavaScript(
            `${fixed.script}\nglobalThis.imageTextTask = ImageTextRenderer.render_page(${JSON.stringify(operation.page)}, ${JSON.stringify(fixed.fontCss)}); true;`,
          ),
        );
        let screenshot: string | undefined;
        while (true) {
          const next = (await step("layout", () =>
            window.webContents.executeJavaScript(
              `globalThis.imageTextTask.next(${JSON.stringify(screenshot)})`,
            ),
          )) as IteratorResult<ImageTextRenderStep, ImageTextPaint[]>;
          screenshot = undefined;
          if (next.done) return next.value;
          if (next.value.kind === "resize") {
            const { width, height } = next.value;
            await step("viewport", () =>
              debuggerPort.sendCommand("Emulation.setDeviceMetricsOverride", {
                width,
                height,
                deviceScaleFactor: 1,
                mobile: false,
              }),
            );
            window.webContents.setZoomFactor(1);
          } else {
            // CDP 等待当前布局的合成帧；位图保持透明，不把画稿交给浏览器重编码。
            const { rect } = next.value;
            const capture = (await step("capture", () =>
              debuggerPort.sendCommand("Page.captureScreenshot", {
                format: "png",
                fromSurface: true,
                captureBeyondViewport: true,
                clip: { ...rect, scale: 1 },
              }),
            )) as { data: string };
            screenshot = capture.data;
          }
        }
      });
    });
    tail = result.catch(() => undefined); // 调用者接收错误，后续页仍能重新创建窗口。
    try {
      return await Promise.race([result, cancelled.promise]);
    } finally {
      combined.removeEventListener("abort", cancelQueued);
    }
  };
  return Object.assign(host, {
    dispose: async () => {
      lifetime.abort();
      await tail;
      browserSession?.webRequest.onBeforeRequest(null);
      await browserSession?.clearStorageData();
    },
  });
}

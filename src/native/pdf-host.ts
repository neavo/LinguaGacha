import { BrowserWindow, session, type Session } from "electron";
import { randomUUID } from "node:crypto";
import type { PDFHost } from "../shared/pdf";

const PDF_HOST_TIMEOUT_MS = 120_000;
const PRINT_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/** Electron 只拥有 HTML 打印。一个窗口串行复用，取消实际销毁窗口后才释放队列。 */
export function create_pdf_host(): PDFHost & { dispose: () => Promise<void> } {
  let window: BrowserWindow | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const lifetime = new AbortController();
  let browser_session: Session | null = null; // GUI 组合根早于 app.ready，首次打印才创建原生资源。
  const close = () => {
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
  };
  const host: PDFHost = async (operation, signal) => {
    const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    const result = tail.then(async () => {
      combined.throwIfAborted();
      if (!browser_session) {
        browser_session = session.fromPartition(`pdf-print-${randomUUID()}`, { cache: false });
        browser_session.webRequest.onBeforeRequest((details, callback) =>
          callback({ cancel: !details.url.startsWith("data:") }),
        );
        browser_session.setPermissionRequestHandler((_contents, _permission, callback) =>
          callback(false),
        );
      }
      if (!window) {
        window = new BrowserWindow({
          show: false,
          webPreferences: {
            session: browser_session,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event) => event.preventDefault());
      }
      const current = window;
      const timeout = setTimeout(close, PDF_HOST_TIMEOUT_MS);
      combined.addEventListener("abort", close, { once: true });
      try {
        // 每次加载新文档，CSP 在调用方内容前生效，页面不能执行脚本或请求外部资源。
        const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">${operation.html}`;
        await current.loadURL("data:text/html;charset=utf-8,<html></html>");
        // 图片内嵌的 HTML 可能很大，通过脚本参数传递以避开导航 URL 长度限制。
        await current.webContents.executeJavaScript(
          `document.open();document.write(${JSON.stringify(html)});document.close();`,
        );
        await current.webContents.executeJavaScript(
          "Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())]).then(() => undefined)",
        );
        combined.throwIfAborted();
        const bytes = await current.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
        });
        combined.throwIfAborted();
        return new Uint8Array(bytes);
      } catch (error) {
        close();
        throw error;
      } finally {
        clearTimeout(timeout);
        combined.removeEventListener("abort", close);
      }
    });
    tail = result.catch(() => undefined); // 错误已通过 result 返回，后续打印仍可重新创建窗口。
    return await result;
  };
  return Object.assign(host, {
    dispose: async () => {
      lifetime.abort();
      await tail;
      close();
      browser_session?.webRequest.onBeforeRequest(null);
      await browser_session?.clearStorageData();
    },
  });
}

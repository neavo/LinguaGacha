import { BrowserWindow, session, type Session } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PDFHost } from "../shared/pdf";
import { default_native_fs } from "./native-fs";

// 打印声明复用界面字体文件，字重与等宽字体缩放决定 PDF 排版。
const PRINT_FONTS = [
  ["LGBaseFont", "LGBaseFont-Regular.woff2", "400", ""],
  ["LGBaseFont", "LGBaseFont-Bold.woff2", "500 700", ""],
  ["LGMono", "MonaspaceNeon.woff2", "400 700", "size-adjust:90%;"],
] as const;

const PDF_HOST_TIMEOUT_MS = 120_000;
const PRINT_CSP =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/** Electron 只拥有 HTML 打印。一个窗口串行复用，取消实际销毁窗口后才释放队列。 */
export function create_pdf_host(resources: {
  stylesPath: string; // 构建生成的内嵌数学样式。
  fontsDirectory: string; // GUI 注入开发或发行资源中的共享字体目录。
}): PDFHost & { dispose: () => Promise<void> } {
  let print_styles: string | null = null; // 宿主生命周期内复用固定版本的字体与数学样式。
  let window: BrowserWindow | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const lifetime = new AbortController();
  let browser_session: Session | null = null; // GUI 组合根早于 app.ready，首次打印才创建原生资源。
  // 销毁窗口会使在途打印失败，队列结算后才能创建下一窗口。
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
        // 只读取应用自带的固定字体，首次打印时编码并缓存，发行包与 UI 共用一份文件。
        print_styles ??=
          PRINT_FONTS.map(([family, file, weight, extra]) => {
            const bytes = default_native_fs.read_file(path.join(resources.fontsDirectory, file));
            return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2");font-weight:${weight};font-style:normal;${extra}}`;
          }).join("\n") +
          "\n" +
          default_native_fs.read_text_file(resources.stylesPath);
        // 每次加载新文档，CSP 在调用方内容前生效，页面不能执行脚本或请求外部资源。
        const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">${operation.html}`;
        await current.loadURL("data:text/html;charset=utf-8,<html></html>");
        // 图片内嵌的 HTML 可能很大，通过脚本参数传递以避开导航 URL 长度限制。
        await current.webContents.executeJavaScript(
          `document.open();document.write(${JSON.stringify(html)});document.close();`,
        );
        // 样式作为文本注入；调用方 HTML 与资源路径互不耦合。
        await current.webContents.executeJavaScript(
          `(() => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(print_styles)}; document.head.prepend(style); })()`,
        );
        await current.webContents.executeJavaScript(
          "Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())]).then(() => undefined)",
        );
        // 按已加载字体测量图注及紧邻标题，整组预留空间。长图注允许在前三行之后自然分页。
        await current.webContents.executeJavaScript(`(() => {
          for (const figure of document.querySelectorAll('.pdf-document figure')) {
            const img = figure.querySelector('img');
            if (!img) continue;
            const caption = figure.querySelector('figcaption');
            const imageStyle = getComputedStyle(img);
            const figureStyle = getComputedStyle(figure);
            const height = parseFloat(imageStyle.maxHeight);
            if (!Number.isFinite(height)) continue;
            const captionStyle = caption && getComputedStyle(caption);
            const captionHeight = caption ? Math.min(caption.getBoundingClientRect().height, parseFloat(captionStyle.lineHeight) * 3) + parseFloat(captionStyle.marginTop) : 0;
            let headingHeight = 0;
            for (let heading = figure.previousElementSibling; heading?.matches('h1,h2,h3,h4,h5,h6'); heading = heading.previousElementSibling) {
              const style = getComputedStyle(heading);
              headingHeight += heading.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
            }
            img.style.maxHeight = Math.max(1, height - headingHeight - captionHeight - parseFloat(figureStyle.marginTop) - parseFloat(figureStyle.marginBottom)) + 'px';
          }
        })()`);
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
    /** 先取消活动任务并排空队列，再释放会话持有的资源。 */
    dispose: async () => {
      lifetime.abort();
      await tail;
      close();
      browser_session?.webRequest.onBeforeRequest(null);
      await browser_session?.clearStorageData();
    },
  });
}

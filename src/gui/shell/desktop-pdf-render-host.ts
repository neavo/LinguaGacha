import { BrowserWindow } from "electron";

import { run_abortable_window_operation } from "../desktop-window-operation";
import { load_renderer_entry } from "./desktop-window-host";
import { render_pdf_markdown_html } from "./pdf-markdown-html";

/** 在一次性 sandbox window 中排版 Markdown，并由 Chromium 生成 PDF bytes。 */
export async function render_desktop_pdf(args: {
  markdown: string;
  desktopBundleDir: string;
  signal: AbortSignal;
}): Promise<Uint8Array> {
  args.signal.throwIfAborted();
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  return await run_abortable_window_operation(window, args.signal, async () => {
    await load_renderer_entry(window, args.desktopBundleDir, "pdf-renderer.html");
    args.signal.throwIfAborted();
    const html = render_pdf_markdown_html(args.markdown);
    await window.webContents.executeJavaScript(
      `(() => {
        const target = document.getElementById("pdf-content");
        if (target === null) throw new Error("PDF renderer content root is missing.");
        target.innerHTML = ${JSON.stringify(html)};
        return document.fonts.ready.then(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
      })()`,
      true,
    );
    args.signal.throwIfAborted();
    return new Uint8Array(
      await window.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
      }),
    );
  });
}

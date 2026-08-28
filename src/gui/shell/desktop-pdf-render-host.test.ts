import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];

    destroyed = false;
    webContents = {
      executeJavaScript: vi.fn(async (_script: string, _user_gesture?: boolean) => true),
      printToPDF: vi.fn(async (_options?: Record<string, unknown>) =>
        Buffer.from([37, 80, 68, 70]),
      ),
    };

    constructor(readonly options: Record<string, unknown>) {
      FakeBrowserWindow.instances.push(this);
    }

    destroy(): void {
      this.destroyed = true;
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }
  }

  return {
    FakeBrowserWindow,
    load_renderer_entry: vi.fn(
      async (_window: unknown, _dir: string, _entry: string): Promise<void> => undefined,
    ),
    render_html: vi.fn((_markdown: string) => "<h1>译题</h1>"),
  };
});

vi.mock("electron", () => ({ BrowserWindow: mocks.FakeBrowserWindow }));
vi.mock("./desktop-window-host", () => ({
  load_renderer_entry: mocks.load_renderer_entry,
}));
vi.mock("./pdf-markdown-html", () => ({
  render_pdf_markdown_html: mocks.render_html,
}));

import { render_desktop_pdf } from "./desktop-pdf-render-host";

describe("render_desktop_pdf", () => {
  beforeEach(() => {
    mocks.FakeBrowserWindow.instances.length = 0;
    mocks.load_renderer_entry.mockReset().mockResolvedValue(undefined);
    mocks.render_html.mockReset().mockReturnValue("<h1>译题</h1>");
  });

  it("在隐藏 sandbox window 中等待字体与两帧布局后打印并销毁", async () => {
    const bytes = await render_desktop_pdf({
      markdown: "# 译题",
      desktopBundleDir: "E:/app/dist-electron",
      signal: new AbortController().signal,
    });
    const window = mocks.FakeBrowserWindow.instances[0]!;

    expect(window.options).toEqual({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    expect(mocks.load_renderer_entry).toHaveBeenCalledWith(
      window,
      "E:/app/dist-electron",
      "pdf-renderer.html",
    );
    const script = String(window.webContents.executeJavaScript.mock.calls[0]?.[0]);
    expect(script).toContain('target.innerHTML = "<h1>译题</h1>"');
    expect(script).toContain("document.fonts.ready");
    expect(script.match(/requestAnimationFrame/gu)).toHaveLength(2);
    expect(window.webContents.printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(bytes).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(window.destroyed).toBe(true);
  });

  it.each(["load", "print"])("%s 失败时仍销毁窗口", async (stage) => {
    if (stage === "load") {
      mocks.load_renderer_entry.mockRejectedValueOnce(new Error("load failed"));
    }
    const running = render_desktop_pdf({
      markdown: "正文",
      desktopBundleDir: "E:/app/dist-electron",
      signal: new AbortController().signal,
    });
    const window = mocks.FakeBrowserWindow.instances[0]!;
    if (stage === "print") {
      window.webContents.printToPDF.mockRejectedValueOnce(new Error("print failed"));
    }

    await expect(running).rejects.toThrow(`${stage} failed`);
    expect(window.destroyed).toBe(true);
  });

  it("abort 会停止流程并销毁窗口", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    mocks.load_renderer_entry.mockImplementationOnce(async () => controller.abort(reason));

    const running = render_desktop_pdf({
      markdown: "正文",
      desktopBundleDir: "E:/app/dist-electron",
      signal: controller.signal,
    });

    await expect(running).rejects.toBe(reason);
    expect(mocks.FakeBrowserWindow.instances[0]?.destroyed).toBe(true);
    expect(mocks.FakeBrowserWindow.instances[0]?.webContents.printToPDF).not.toHaveBeenCalled();
  });
});

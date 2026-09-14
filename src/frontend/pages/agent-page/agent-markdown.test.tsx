import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 当前组件的外部协作者集中在同一可重置夹具中，测试仍观察最终 DOM。
const mocks = vi.hoisted(() => ({
  open_external_url: vi.fn(),
  api_fetch: vi.fn(),
  push_toast: vi.fn(),
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  open_external_url: mocks.open_external_url,
  api_fetch: mocks.api_fetch,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({ push_toast: mocks.push_toast }),
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));

import { AgentMarkdown } from "./agent-markdown";

describe("AgentMarkdown", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    mocks.open_external_url.mockReset();
    mocks.open_external_url.mockResolvedValue(undefined);
    mocks.api_fetch.mockReset();
    mocks.api_fetch.mockResolvedValue({ status: "opened" });
    mocks.push_toast.mockReset();
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  /** 复用同一 React 根节点，让流式与完整消息切换走真实重复渲染生命周期。 */
  async function render_markdown(text: string, streaming: boolean): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(<AgentMarkdown text={text} streaming={streaming} />));
    return container;
  }

  it("渲染富文本和远程图片，并把链接交给宿主", async () => {
    const view = await render_markdown(
      '<span style="color: red">重点</span>\n\n[证据](https://example.com)\n\n![示意图](https://example.com/a.png)',
      false,
    );
    const link = view.querySelector<HTMLAnchorElement>('a[href="https://example.com"]');
    if (link === null) throw new Error("缺少 Markdown 链接");

    await act(async () => link.click());
    const rich_text = view.querySelector<HTMLSpanElement>("span");
    expect(rich_text?.textContent).toBe("重点");
    expect(rich_text?.style.color).toBe("red");
    expect(mocks.open_external_url).toHaveBeenCalledWith("https://example.com");
    expect(view.querySelector<HTMLImageElement>('img[src="https://example.com/a.png"]')?.alt).toBe(
      "示意图",
    );
  });

  it("工作区链接把编码路径交给工作区 API，失败只提示一次", async () => {
    const view = await render_markdown(
      "[报告](work/报告%20%23%25.md)\n\n[目录](work/reports/)",
      false,
    );
    const links = view.querySelectorAll<HTMLAnchorElement>("a");
    await act(async () => links[0]?.click());
    expect(mocks.api_fetch).toHaveBeenCalledWith("/api/agent/workspace/activate-path", {
      path: "work/%E6%8A%A5%E5%91%8A%20%23%25.md",
    });
    mocks.api_fetch.mockRejectedValueOnce(new Error("missing"));
    await act(async () => links[1]?.click());
    expect(mocks.api_fetch).toHaveBeenLastCalledWith("/api/agent/workspace/activate-path", {
      path: "work/reports/",
    });
    expect(mocks.open_external_url).not.toHaveBeenCalled();
    expect(mocks.push_toast).toHaveBeenCalledOnce();
  });

  it("待决链接只提交一次，保存通知后可再次点击并安静取消", async () => {
    const view = await render_markdown("[保存报告](work/report.md)", false);
    let finish!: (value: { status: string }) => void;
    mocks.api_fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const link = view.querySelector("a");
    await act(async () => {
      link?.click();
      link?.click();
    });
    expect(mocks.api_fetch).toHaveBeenCalledOnce();
    expect(mocks.push_toast).not.toHaveBeenCalled();
    await act(async () => finish({ status: "saved" }));
    expect(mocks.push_toast).toHaveBeenCalledExactlyOnceWith("success", "agent_page.file_saved");
    mocks.api_fetch.mockResolvedValueOnce({ status: "cancelled" });
    await act(async () => link?.click());
    expect(mocks.api_fetch).toHaveBeenCalledTimes(2);
    expect(mocks.push_toast).toHaveBeenCalledOnce();
  });

  it("被过滤的目标呈现文本，页内链接保留原生跳转", async () => {
    const view = await render_markdown(
      '[文件](file:///E:/report.md)\n\n[盘符](E:/report.md)\n\n[跳转](#section)\n\n<span id="section">目标</span>',
      false,
    );
    expect(view.textContent).toContain("文件");
    expect(view.querySelectorAll("a")).toHaveLength(1);
    const link = view.querySelector("a");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      link?.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(mocks.open_external_url).not.toHaveBeenCalled();
    expect(mocks.api_fetch).not.toHaveBeenCalled();
  });

  it("Markdown 图片使用与附件相同的媒体预览画布", async () => {
    const view = await render_markdown("![示意图](https://example.com/a.png)", false);
    const trigger = view.querySelector<HTMLButtonElement>(".agent-markdown__image-trigger");
    if (trigger === null) throw new Error("缺少 Markdown 图片预览入口");

    await act(async () => trigger.click());

    const dialog = document.body.querySelector('[data-slot="dialog-content"]');
    expect(dialog?.querySelector('img[src="https://example.com/a.png"]')).not.toBeNull();
    expect(dialog?.querySelector(".agent-media-preview-dialog__viewport")).not.toBeNull();
  });

  it("代码使用官方高亮并提供复制和下载入口", async () => {
    const write_text = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const source = 'const heroine = "Lingua";';
    const view = await render_markdown("```js\n" + source + "\n```", false);
    await act(async () => {
      await vi.waitFor(() => {
        // 纯文本占位也含源码；颜色差异证明官方高亮插件实际参与了渲染。
        const colors = new Set(
          [...view.querySelectorAll<HTMLElement>("pre code span")]
            .map((span) => span.style.getPropertyValue("--sdm-c"))
            .filter((color) => color && color !== "inherit"),
        );
        expect(colors.size).toBeGreaterThan(1);
      });
    });
    expect(view.querySelector('[title="agent_page.markdown.copy_code"]')).not.toBeNull();
    expect(view.querySelector('[title="agent_page.markdown.download_code"]')).not.toBeNull();
    await act(async () =>
      view.querySelector<HTMLButtonElement>('[title="agent_page.markdown.copy_code"]')?.click(),
    );
    expect(write_text).toHaveBeenCalledWith(`${source}\n`);
  });

  it("未完成链接保持文字，完成后才激活工作区路径", async () => {
    const view = await render_markdown("[报告", true);
    expect(view.textContent).toContain("报告");
    expect(view.querySelector("a")).toBeNull();
    await render_markdown("[报告](work/report.md)", false);
    await act(async () => view.querySelector("a")?.click());
    expect(mocks.api_fetch).toHaveBeenCalledWith("/api/agent/workspace/activate-path", {
      path: "work/report.md",
    });
  });

  it("流式正文保留富文本与未完成语法，结束后渲染表格", async () => {
    const view = await render_markdown("<mark>进行中</mark>\n\n**进行中", true);
    expect(view.querySelector("mark")?.textContent).toBe("进行中");
    expect(view.querySelector("strong")?.textContent).toBe("进行中");
    await render_markdown("**已完成**\n\n| 名称 |\n| --- |\n| 内容 |", false);
    expect(view.querySelector("strong")?.textContent).toBe("已完成");
    expect(view.querySelector("table")?.textContent).toContain("内容");
    expect(
      [...view.querySelectorAll('[data-streamdown="table-wrapper"] > div:first-child button')].map(
        (button) => button.getAttribute("title"),
      ),
    ).toEqual(["agent_page.markdown.download_table", "agent_page.markdown.copy_table"]);
  });

  it("未知语言保留代码文本", async () => {
    const view = await render_markdown("```linguagacha-unknown\nconst unknown = true;\n```", false);
    expect(view.querySelector("pre code")?.textContent).toContain("const unknown = true;");
  });

  it("图表获得焦点后接收滚轮，Escape 和失焦后恢复页面滚动", async () => {
    const view = await render_markdown(
      '<div data-streamdown="mermaid"><span>图表</span></div>\n\n普通正文',
      false,
    );
    const diagram = view.querySelector('[data-streamdown="mermaid"]');
    const text = view.querySelector("p");
    if (!diagram || !text) throw new Error("缺少正文测试节点");
    const zoom = vi.fn((event: Event) => event.preventDefault());
    diagram.addEventListener("wheel", zoom);
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 });
    diagram.querySelector("span")?.dispatchEvent(wheel);
    expect(zoom).not.toHaveBeenCalled();
    expect(wheel.defaultPrevented).toBe(false);
    diagram
      .querySelector("span")
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(document.activeElement).toBe(diagram);
    diagram.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }),
    );
    expect(zoom).toHaveBeenCalledOnce();
    diagram.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).not.toBe(diagram);
    diagram.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }),
    );
    expect(zoom).toHaveBeenCalledOnce();
    (diagram as HTMLElement).focus();
    const outside = document.createElement("button");
    view.append(outside);
    outside.focus();
    diagram.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }),
    );
    expect(zoom).toHaveBeenCalledOnce();
    const on_text_wheel = vi.fn();
    text.addEventListener("wheel", on_text_wheel);
    text.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }));
    expect(on_text_wheel).toHaveBeenCalledOnce();
  });

  it("将单美元行内公式和独立公式渲染为数学内容", async () => {
    const view = await render_markdown("行内 $E = mc^2$。\n\n$$\n\\frac{1}{2}\n$$", false);
    expect(view.querySelectorAll(".katex")).toHaveLength(2);
    expect(view.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(
      [...view.querySelectorAll('annotation[encoding="application/x-tex"]')].map(
        (node) => node.textContent,
      ),
    ).toEqual(["E = mc^2", "\\frac{1}{2}"]);
  });

  it("提示块扩展保留正文格式", async () => {
    const view = await render_markdown("> [!IMPORTANT]\n> 保留 **重点**。", false);
    const alert = view.querySelector(".markdown-alert-important");
    expect(alert?.querySelector(".markdown-alert-title")?.textContent).toBe("IMPORTANT");
    expect(alert?.querySelector("strong")?.textContent).toBe("重点");
    expect(alert?.textContent).not.toContain("[!IMPORTANT]");
  });
});

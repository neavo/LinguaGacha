import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 当前组件的外部协作者集中在同一可重置夹具中，测试仍观察最终 DOM。
const mocks = vi.hoisted(() => ({
  open_external_url: vi.fn(),
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  open_external_url: mocks.open_external_url,
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("./agent-mermaid", () => ({
  AgentMermaidBlock: ({ source }: { source: string }) => <div data-agent-mermaid-source={source} />,
}));

import { AgentMarkdown } from "./agent-markdown";

describe("AgentMarkdown", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    mocks.open_external_url.mockReset();
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

  it("渲染 GFM、富文本和远程图片，并把链接交给宿主", async () => {
    const view = await render_markdown(
      '| 名称 | 值 |\n| --- | --- |\n| A | 1 |\n\n<span style="color: red">重点</span>\n\n[证据](https://example.com)\n\n![示意图](https://example.com/a.png)',
      false,
    );
    const link = view.querySelector<HTMLAnchorElement>('a[href="https://example.com"]');
    if (link === null) throw new Error("缺少 Markdown 链接");

    await act(async () => link.click());
    expect(view.querySelector("table")?.textContent).toContain("名称");
    const rich_text = view.querySelector<HTMLSpanElement>("span");
    expect(rich_text?.textContent).toBe("重点");
    expect(rich_text?.style.color).toBe("red");
    expect(mocks.open_external_url).toHaveBeenCalledWith("https://example.com");
    expect(view.querySelector<HTMLImageElement>('img[src="https://example.com/a.png"]')?.alt).toBe(
      "示意图",
    );
  });

  it("Markdown 图片使用与附件相同的媒体预览画布", async () => {
    const view = await render_markdown("![示意图](https://example.com/a.png)", false);
    const trigger = view.querySelector<HTMLButtonElement>(".agent-markdown__image-trigger");
    if (trigger === null) throw new Error("缺少 Markdown 图片预览入口");

    await act(async () => trigger.click());

    const dialog = document.body.querySelector('[data-slot="dialog-content"]');
    expect(dialog?.querySelector('img[src="https://example.com/a.png"]')).not.toBeNull();
    expect(dialog?.querySelector('[aria-label="agent_page.media.zoom_in"]')).not.toBeNull();
    expect(dialog?.querySelector('[aria-label="agent_page.media.zoom_out"]')).not.toBeNull();
    expect(dialog?.querySelector('[aria-label="agent_page.media.reset_zoom"]')).not.toBeNull();
    expect(dialog?.querySelector(".agent-media-preview-dialog__viewport")).not.toBeNull();
  });

  it("流式消息也渲染富文本", async () => {
    const view = await render_markdown("<mark>进行中</mark>", true);

    expect(view.querySelector("mark")?.textContent).toBe("进行中");
  });

  it("保留同一引用块中的软换行", async () => {
    const view = await render_markdown("> 第一行\n> 第二行\n> 第三行", false);
    const quotes = view.querySelectorAll("blockquote");

    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.querySelector("p")?.textContent).toBe("第一行\n第二行\n第三行");
  });

  it("用空行区分独立引用块，而不是依赖引用行换行", async () => {
    const view = await render_markdown("> 第一块\n\n> 第二块", false);
    const quotes = view.querySelectorAll("blockquote");

    expect(quotes).toHaveLength(2);
    expect(quotes[0]?.querySelector("p")?.textContent).toBe("第一块");
    expect(quotes[1]?.querySelector("p")?.textContent).toBe("第二块");
  });

  it("保留 GFM 删除线与脚注结构", async () => {
    const view = await render_markdown("~~旧文本~~\n\n说明[^1]\n\n[^1]: 脚注内容", false);

    expect(view.querySelector("del")?.textContent).toBe("旧文本");
    expect(view.querySelector("[data-footnotes]")?.textContent).toContain("脚注内容");
  });

  it("只在完整消息中高亮带显式语言的代码块", async () => {
    const source = 'const heroine = "Lingua";';
    const view = await render_markdown(`\`\`\`js\n${source}\n\`\`\``, true);

    expect(view.querySelector('pre[data-language="js"]')).not.toBeNull();
    expect(view.querySelector("code.language-js")?.textContent).toBe(`${source}\n`);
    expect(view.querySelector("code.hljs")).toBeNull();

    await render_markdown(`\`\`\`js\n${source}\n\`\`\``, false);

    expect(view.querySelector("code.hljs.language-js")?.textContent).toBe(`${source}\n`);
    expect(view.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(view.querySelector(".hljs-string")?.textContent).toBe('"Lingua"');
  });

  it("无语言或未知语言的代码块保持纯文本", async () => {
    const view = await render_markdown(
      "```\nconst plain = true;\n```\n\n```linguagacha-unknown\nconst unknown = true;\n```",
      false,
    );

    const code_blocks = view.querySelectorAll("pre code");
    const unknown = view.querySelector("code.language-linguagacha-unknown");

    expect(code_blocks).toHaveLength(2);
    expect(code_blocks[0]?.className).toBe("");
    expect(code_blocks[0]?.parentElement?.hasAttribute("data-language")).toBe(false);
    expect(unknown?.parentElement?.dataset.language).toBe("linguagacha-unknown");
    expect(unknown?.querySelector("span")).toBeNull();
    expect(unknown?.textContent).toContain("const unknown = true;");
  });

  it("流式 Mermaid 保留源码且不加载渲染器", async () => {
    const view = await render_markdown(mermaid_block("flowchart LR\nA-->B"), true);

    expect(view.querySelector("code.language-mermaid")?.textContent).toBe("flowchart LR\nA-->B\n");
    expect(view.querySelector("pre")?.hasAttribute("data-language")).toBe(false);
    expect(view.querySelector("figure.agent-markdown__diagram")).toBeNull();
  });

  it("把完整消息中的显式 Mermaid 围栏交给图表组件", async () => {
    const view = await render_markdown(mermaid_block("flowchart LR\nA-->B"), false);

    expect(
      view.querySelector("[data-agent-mermaid-source]")?.getAttribute("data-agent-mermaid-source"),
    ).toBe("flowchart LR\nA-->B");
    expect(view.querySelector("code.language-mermaid")).toBeNull();
  });

  it("只识别完整消息中的显式 mermaid 围栏", async () => {
    const view = await render_markdown(
      "```mmd\nflowchart LR\nA-->B\n```\n\nflowchart LR\nA-->B",
      false,
    );

    expect(view.querySelector("code.language-mmd")?.textContent).toContain("flowchart LR");
    expect(view.querySelector('pre[data-language="mmd"]')).not.toBeNull();
    expect(view.querySelector("figure.agent-markdown__diagram")).toBeNull();
  });
});

/** 构造唯一会进入图表渲染分支的显式 Mermaid 围栏。 */
function mermaid_block(source: string): string {
  return `\`\`\`mermaid\n${source}\n\`\`\``;
}

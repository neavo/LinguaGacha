import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 当前组件的外部协作者集中在同一可重置夹具中，测试仍观察最终 DOM。
const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  open_external_url: vi.fn(),
  render: vi.fn(),
  theme: { current: "light" as string | undefined },
}));

vi.mock("mermaid", () => ({
  default: { initialize: mocks.initialize, render: mocks.render },
}));
vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: mocks.theme.current }),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({
  open_external_url: mocks.open_external_url,
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { AgentMarkdown } from "./agent-markdown";

describe("AgentMarkdown", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    mocks.theme.current = "light";
    mocks.initialize.mockReset();
    mocks.open_external_url.mockReset();
    mocks.render.mockReset();
    mocks.render.mockImplementation(async (id: string) => ({
      svg: `<svg data-diagram-id="${id}"></svg>`,
    }));
    set_theme_tokens();
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  /** 复用同一 React root，主题与源码切换用例因此走真实 rerender 生命周期。 */
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
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("只识别完整消息中的显式 mermaid 围栏", async () => {
    const view = await render_markdown(
      "```mmd\nflowchart LR\nA-->B\n```\n\nflowchart LR\nA-->B",
      false,
    );

    expect(view.querySelector("code.language-mmd")?.textContent).toContain("flowchart LR");
    expect(view.querySelector('pre[data-language="mmd"]')).not.toBeNull();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("完成后生成可聚焦图表并保持 Mermaid 隔离与宿主主题", async () => {
    const view = await render_markdown(mermaid_block("flowchart LR\nA-->B"), false);
    await wait_for_condition(() => view.querySelector("figure svg") !== null);

    const figure = view.querySelector<HTMLElement>("figure.agent-markdown__diagram");
    expect(figure?.tabIndex).toBe(0);
    expect(view.querySelector("code.language-mermaid")).toBeNull();
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        secure: ["theme", "themeVariables", "themeCSS", "fontFamily"],
        themeVariables: expect.objectContaining({
          background: "#f00001",
          darkMode: false,
        }),
      }),
    );
  });

  it("主题切换重新渲染且忽略旧源码的迟到结果", async () => {
    const first = deferred<{ svg: string }>();
    mocks.render.mockImplementationOnce(() => first.promise);
    const view = await render_markdown(mermaid_block("flowchart LR\nOld-->Value"), false);
    await wait_for_condition(() => mocks.render.mock.calls.length === 1);

    mocks.theme.current = "dark";
    await render_markdown(mermaid_block("flowchart LR\nNew-->Value"), false);
    await wait_for_condition(() => mocks.render.mock.calls.length === 2);
    await wait_for_condition(() => view.querySelector("svg[data-diagram-id]") !== null);
    first.resolve({ svg: '<svg data-diagram="old"></svg>' });
    await act(async () => await Promise.resolve());

    expect(view.querySelector('svg[data-diagram="old"]')).toBeNull();
    expect(mocks.render.mock.calls[1]?.[1]).toBe("flowchart LR\nNew-->Value");
    expect(mocks.initialize.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        themeVariables: expect.objectContaining({ darkMode: true }),
      }),
    );
  });

  it("渲染失败后显示提示与源码", async () => {
    mocks.render.mockRejectedValueOnce(new Error("bad diagram"));
    const view = await render_markdown(mermaid_block("invalid"), false);
    await wait_for_condition(
      () => view.textContent?.includes("agent_page.diagram.render_failed") === true,
    );

    expect(view.querySelector("code.language-mermaid")?.textContent).toBe("invalid");
  });
});

/** 构造唯一会进入图表渲染分支的显式 Mermaid 围栏。 */
function mermaid_block(source: string): string {
  return `\`\`\`mermaid\n${source}\n\`\`\``;
}

/** 为 Mermaid 主题配置提供稳定的应用 token。 */
function set_theme_tokens(): void {
  const style = document.documentElement.style;
  style.setProperty("--popover", "#f00001");
  style.setProperty("--muted", "#e5e7eb");
  style.setProperty("--foreground", "#25272c");
  style.setProperty("--border", "#d6dae0");
  style.setProperty("--accent", "#eef0f3");
  style.setProperty("--secondary", "#e8eaee");
  style.setProperty("--muted-foreground", "#717783");
}

/** 控制旧 Mermaid render 的完成时机，用于证明 effect 会丢弃迟到结果。 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve_promise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolve_promise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolve_promise?.(value),
  };
}

/** 只冲刷微任务队列，不用固定延时等待 React 异步状态。 */
async function wait_for_condition(predicate: () => boolean, attempts = 30): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error("等待 Agent Markdown 状态收敛失败。");
}

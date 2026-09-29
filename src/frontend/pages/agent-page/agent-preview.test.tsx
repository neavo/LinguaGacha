import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { AgentPreviewPage } from "./agent-preview";

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: vi.fn(async () => ({ content: "正文" })),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("./agent-markdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => (
    <h1 id={text === "新章节" ? text : "结论"}>{text}</h1>
  ),
}));

it("每个文档保留阅读位置，锚点只在新的打开意图中定位", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll: Record<string, number> = {};
  const locate = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  /** 同时保留两个实例，模拟页内切换和正文重读。 */
  const render = async (active: string, activation: number) => {
    await act(async () =>
      root.render(
        <>
          {["a", "b"].map((path) => (
            <AgentPreviewPage
              key={path}
              active={active === path}
              scroll={scroll}
              document={{
                path,
                name: path,
                kind: "file",
                preview: "markdown",
                anchor: "结论",
                activation,
              }}
            />
          ))}
        </>,
      ),
    );
  };
  try {
    await render("a", 1);
    const first = container.querySelector<HTMLElement>(".agent-document")!;
    first.scrollTop = 120;
    await act(async () => first.dispatchEvent(new Event("scroll", { bubbles: true })));
    await render("b", 1);
    expect(locate.mock.contexts.at(-1)).toBe(container.querySelectorAll("h1")[1]);
    locate.mockClear();
    await render("a", 1);
    expect(container.querySelector(".agent-document")).toBe(first);
    expect(first.scrollTop).toBe(120);
    expect(locate).not.toHaveBeenCalled();
    await render("a", 2);
    expect(locate).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    locate.mockRestore();
  }
});

it("刷新锚点等待新正文，旧正文不能提前消费定位意图", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const locate = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  const preview = {
    path: "work/report.md",
    name: "报告",
    kind: "file" as const,
    preview: "markdown" as const,
    anchor: null,
    activation: 0,
  };
  let finish!: (value: { content: string }) => void;
  try {
    await act(async () => root.render(<AgentPreviewPage document={preview} active scroll={{}} />));
    vi.mocked(api_fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () =>
      root.render(
        <AgentPreviewPage
          document={{ ...preview, anchor: "新章节", activation: 1 }}
          active
          scroll={{}}
        />,
      ),
    );
    expect(locate).not.toHaveBeenCalled();
    await act(async () => finish({ content: "新章节" }));
    expect(locate.mock.contexts).toEqual([container.querySelector('h1[id="新章节"]')]);
  } finally {
    await act(async () => root.unmount());
    locate.mockRestore();
  }
});

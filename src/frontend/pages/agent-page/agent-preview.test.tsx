import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { AgentPreviewPage } from "./agent-preview";

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: vi.fn(async () => ({ content: "正文" })),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/appearance/appearance-context", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));
vi.mock("./agent-markdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => (
    <h1 id={text === "新章节" ? text : "结论"}>{text}</h1>
  ),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.mocked(api_fetch).mockReset().mockResolvedValue({ content: "正文" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it.each(["json", "jsonl"] as const)(
  "%s 解析失败提示不可用，重新打开恢复只读高亮视图",
  async (format) => {
    vi.mocked(api_fetch).mockResolvedValueOnce({
      content: format === "json" ? "{bad}" : '{"ok":1}\n{bad}',
    });
    await act(async () =>
      root.render(
        <AgentPreviewPage
          active
          scroll={{}}
          document={{
            path: `work/data.${format}`,
            name: `data.${format}`,
            kind: "file",
            preview: format,
            anchor: null,
            activation: 0,
          }}
        />,
      ),
    );
    expect(container.querySelector("[role=status]")?.textContent).toBe(
      "app.feedback.content_unavailable",
    );
    expect(container.querySelector(".cm-content")).toBeNull();
    vi.mocked(api_fetch).mockResolvedValueOnce({ content: '{"ok":1}' });
    expect(container.querySelector("button")).toBeNull();
    await act(async () =>
      root.render(
        <AgentPreviewPage
          active
          scroll={{}}
          document={{
            path: `work/data.${format}`,
            name: `data.${format}`,
            kind: "file",
            preview: format,
            anchor: null,
            activation: 1,
          }}
        />,
      ),
    );
    const view = EditorView.findFromDOM(container.querySelector(".cm-content")!)!;
    expect(view.state.readOnly).toBe(true);
    expect(container.querySelector(".cm-viewer-number")?.textContent).toBe("1");
    expect(JSON.parse(view.state.doc.toString())).toEqual({ ok: 1 });
    expect(container.querySelector(".agent-document p")).toBeNull();
  },
);

it("每个文档保留阅读位置，锚点只在新的打开意图中定位", async () => {
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
});

it("刷新锚点等待新正文，旧正文不能提前消费定位意图", async () => {
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
});

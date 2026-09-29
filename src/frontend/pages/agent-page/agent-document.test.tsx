import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentDocumentPage } from "./agent-document";

vi.mock("./agent-markdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => <h1 id="结论">{text}</h1>,
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
            <AgentDocumentPage
              key={path}
              active={active === path}
              scroll={scroll}
              document={{ sessionId: "session", path, content: path, anchor: "结论", activation }}
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

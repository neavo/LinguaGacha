import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofreadingContextView } from "./proofreading-context-view";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "app.action.retry": "重试",
        "proofreading_page.context.load_failed": "无法读取上下文",
        "proofreading_page.context.loading": "正在读取上下文 …",
        "proofreading_page.title": "校对",
        "proofreading_page.fields.source": "原文",
        "proofreading_page.fields.translation": "译文",
      })[key] ?? key,
  }),
}));

describe("ProofreadingContextView", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  // 复用同一 React root，便于在加载、错误与完成状态之间重渲染。
  function render_view(element: JSX.Element): HTMLDivElement {
    container ??= document.createElement("div");
    if (!container.isConnected) {
      document.body.append(container);
    }
    root ??= createRoot(container);
    act(() => root?.render(element));
    return container;
  }

  it("按自然顺序展示双栏上下文并用草稿覆盖当前译文", () => {
    const rendered = render_view(
      <ProofreadingContextView
        state={{
          status: "ready",
          items: [
            {
              row_id: "19",
              row_number: 19,
              src: "前文",
              dst: "前译",
              name_src: "甲",
              name_dst: "A",
            },
            {
              row_id: "20",
              row_number: 20,
              src: "目标 原文　含\t缩进",
              dst: "旧译文",
              name_src: "乙",
              name_dst: "旧姓名",
            },
            {
              row_id: "21",
              row_number: 21,
              src: "后文",
              dst: "后译",
              name_src: null,
              name_dst: null,
            },
          ],
        }}
        target_row_id="20"
        file_path="chapter.txt"
        draft_item={{ dst: "草稿译文", name_dst: "新姓名" }}
        on_retry={() => {}}
      />,
    );

    expect(rendered.querySelectorAll("li")).toHaveLength(3);
    const current = rendered.querySelector("li[aria-current='true']");
    expect(current?.textContent).not.toContain("当前");
    expect(current?.textContent).toContain("#20");
    expect(current?.textContent).toContain("目标 原文　含\t缩进");
    expect(current?.textContent).toContain("草稿译文");
    expect(current?.textContent).toContain("新姓名");
    expect(current?.textContent).not.toContain("旧译文");
    expect(current?.textContent).not.toContain("旧姓名");
    expect(
      current?.querySelector(".proofreading-page__context-whitespace--space")?.textContent,
    ).toBe(" ");
    expect(
      current?.querySelector(".proofreading-page__context-whitespace--fullwidth-space")
        ?.textContent,
    ).toBe("　");
    expect(current?.querySelector(".proofreading-page__context-whitespace--tab")?.textContent).toBe(
      "\t",
    );
  });

  it("显示加载和可重试错误状态", () => {
    const on_retry = vi.fn();
    const rendered = render_view(
      <ProofreadingContextView
        state={{ status: "loading" }}
        target_row_id="20"
        file_path="chapter.txt"
        draft_item={{ dst: "", name_dst: "" }}
        on_retry={on_retry}
      />,
    );
    expect(rendered.querySelector("[role='status']")?.textContent).toContain("正在读取上下文");

    render_view(
      <ProofreadingContextView
        state={{ status: "error" }}
        target_row_id="20"
        file_path="chapter.txt"
        draft_item={{ dst: "", name_dst: "" }}
        on_retry={on_retry}
      />,
    );
    const retry = [...rendered.querySelectorAll("button")].find(
      (button) => button.textContent === "重试",
    );
    expect(rendered.querySelector("[role='alert']")?.textContent).toContain("无法读取上下文");
    act(() => retry?.click());
    expect(on_retry).toHaveBeenCalledOnce();
  });
});

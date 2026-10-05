import { type JSX, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofreadingContextView } from "./proofreading-context-view";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
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

  it("编辑按钮传递目标条目，忙碌时禁用", () => {
    const on_open_item = vi.fn(async () => {});
    const view = (disabled: boolean) => (
      <ProofreadingContextView
        disabled={disabled}
        on_open_item={on_open_item}
        target_row_id="1"
        file_path="chapter.txt"
        draft_item={{ dst: "草稿", name_dst: "" }}
        state={{
          status: "ready",
          items: [1, 2].map((id) => ({
            row_id: String(id),
            row_number: id,
            src: "原文",
            dst: "译文",
            name_src: null,
            name_dst: null,
          })),
        }}
      />
    );
    const rendered = render_view(view(false));
    act(() => {
      rendered.querySelectorAll<HTMLButtonElement>("button")[1]!.click();
    });
    expect(on_open_item).toHaveBeenCalledWith("2");
    render_view(view(true));
    expect(
      [...rendered.querySelectorAll<HTMLButtonElement>("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
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

  it("当前条目展示草稿译文和译名，正文保留可复制的空白", () => {
    const rendered = render_view(
      <ProofreadingContextView
        disabled={false}
        on_open_item={async () => {}}
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
      />,
    );

    const current = rendered.querySelector("li[aria-current='true']");
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

  it("显示加载和紧凑不可用状态", () => {
    const rendered = render_view(
      <ProofreadingContextView
        disabled={false}
        on_open_item={async () => {}}
        state={{ status: "loading" }}
        target_row_id="20"
        file_path="chapter.txt"
        draft_item={{ dst: "", name_dst: "" }}
      />,
    );
    expect(rendered.querySelector("[role='status']")?.textContent).toContain(
      "proofreading_page.context.loading",
    );

    render_view(
      <ProofreadingContextView
        disabled={false}
        on_open_item={async () => {}}
        state={{ status: "error" }}
        target_row_id="20"
        file_path="chapter.txt"
        draft_item={{ dst: "", name_dst: "" }}
      />,
    );
    expect(rendered.querySelector("[role='status']")?.textContent).toContain(
      "app.feedback.content_unavailable",
    );
    expect(rendered.querySelector("button")).toBeNull();
  });
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofreadingTable } from "@frontend/pages/proofreading-page/components/proofreading-table";
import type {
  ProofreadingClientItem,
  ProofreadingRow,
  ProofreadingVisibleItem,
} from "@shared/proofreading/proofreading-types";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
vi.mock("@frontend/app/locale/locale-context", () => {
  return {
    useI18n: () => {
      return {
        t: (key: string, params?: Record<string, string>) => params?.VALUE ?? key,
      };
    },
  };
});

// `happy-dom` 不计算布局，尺寸观测使用固定视口以运行真实虚拟列表。
vi.mock("@tanstack/react-virtual", async (import_original) => {
  const actual = await import_original<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (options: Parameters<typeof actual.useVirtualizer>[0]) =>
      actual.useVirtualizer({
        ...options,
        observeElementRect: (_instance, callback) => {
          callback({ width: 800, height: 600 });
        },
      }),
  };
});

// 摘要与正文故意不同，验证浮层读取完整字段而非重复表格摘要。
function create_visible_item(overrides: Partial<ProofreadingClientItem>): ProofreadingVisibleItem {
  const item: ProofreadingClientItem = {
    item_id: 1,
    row_id: "1",
    file_path: "chapter.txt",
    row_number: 1,
    src: "原文",
    dst: "译文",
    name_src: "Alice",
    name_dst: "爱丽丝",
    status: "PROCESSED",
    retry_count: 0,
    warnings: [],
    warning_fragments_by_code: {},
    glossary_applications: [],
    compressed_src: "src-preview",
    compressed_dst: "dst-preview",
    ...overrides,
  };
  return {
    kind: "item",
    row_id: item.row_id,
    item,
    compressed_src: item.compressed_src,
    compressed_dst: item.compressed_dst,
  };
}

describe("ProofreadingTable", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
  });

  // 挂载生产表格，行读取沿用页面提供的远端窗口接口。
  async function render_table(
    item: ProofreadingRow,
    on_open_edit = vi.fn(),
    on_selection_change = vi.fn(),
  ): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ProofreadingTable
            items={[item]}
            visible_row_count={1}
            sort_state={null}
            selected_row_ids={[]}
            active_row_id={item.row_id}
            anchor_row_id={null}
            retranslating_row_ids={[]}
            readonly={false}
            get_row_at_index={(index) => (index === 0 ? item : undefined)}
            get_row_id_at_index={(index) => (index === 0 ? item.row_id : undefined)}
            resolve_row_index={(id) => (id === item.row_id ? 0 : undefined)}
            resolve_row_index_async={async () => undefined}
            resolve_row_ids_range={async () => []}
            on_visible_range_change={() => {}}
            scroll_to_row={null}
            preserve_scroll_anchor={{ row_id: null, revision: 0 }}
            on_sort_change={() => {}}
            on_selection_change={on_selection_change}
            on_selection_error={() => {}}
            on_open_edit={on_open_edit}
            on_request_retranslate_row_ids={() => {}}
            on_request_clear_translation_row_ids={() => {}}
            on_request_set_translation_status_row_ids={() => {}}
          />
        </TooltipProvider>,
      );
    });
  }

  it.each([
    ["src", "原文第一行\n  原文第二行"],
    ["dst", "译文第一行\n  译文第二行"],
  ])("%s 仅由尾部按钮悬浮预览完整正文，保留换行且不混入姓名", async (column, body) => {
    vi.useFakeTimers();
    await render_table(
      create_visible_item({
        [column]: body,
      }),
    );
    const cell = container!.querySelector<HTMLElement>(
      `.proofreading-page__table-${column === "src" ? "source" : "translation"}-cell`,
    )!;
    const text = cell.querySelector<HTMLElement>(".proofreading-page__table-text")!;
    await act(async () => {
      text.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      text.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    const trigger = cell.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(body);
  });

  it("原文和译文为空时省略预览入口", async () => {
    await render_table(
      create_visible_item({ src: "", dst: "", compressed_src: "", compressed_dst: "" }),
    );
    expect(container!.querySelector(".proofreading-page__table-text-line button")).toBeNull();
  });

  it("键盘聚焦预览按钮显示全文，按 Esc 关闭且不激活行", async () => {
    vi.useFakeTimers();
    const on_open_edit = vi.fn();
    await render_table(create_visible_item({ src: "完整原文" }), on_open_edit);
    const trigger = container!.querySelector<HTMLButtonElement>(
      ".proofreading-page__table-source-cell button",
    )!;
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      trigger.focus();
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"][data-open]')?.textContent).toBe("完整原文");
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"][data-open]')).toBeNull();
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(on_open_edit).not.toHaveBeenCalled();
  });

  it("预览按钮不选择、激活或框选行，正文仍可双击编辑", async () => {
    const on_open_edit = vi.fn();
    const on_selection_change = vi.fn();
    await render_table(create_visible_item({}), on_open_edit, on_selection_change);
    const trigger = container!.querySelector<HTMLButtonElement>(
      ".proofreading-page__table-source-cell button",
    )!;
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 1, clientY: 1 }),
      );
      trigger.click();
      trigger.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(on_selection_change).not.toHaveBeenCalled();
    expect(on_open_edit).not.toHaveBeenCalled();
    expect(container!.querySelector(".app-table__selection-box")).toBeNull();

    const text = container!.querySelector<HTMLElement>(
      ".proofreading-page__table-source-cell .proofreading-page__table-text",
    )!;
    await act(async () => text.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(on_open_edit).toHaveBeenCalledWith("1");
  });

  it.each(["NONE", "PROCESSED"] as const)("页面 %s 的入口、状态提示和双击查看", async (status) => {
    vi.useFakeTimers();
    const on_open = vi.fn();
    await render_table(
      {
        kind: "page",
        row_id: 'page:["book.pdf",1]',
        page: {
          file_path: "book.pdf",
          page: 1,
          status,
        },
      },
      on_open,
    );
    const translation = container!.querySelector<HTMLElement>(
      ".proofreading-page__table-translation-cell",
    )!;
    const status_cell = container!.querySelector<HTMLElement>(
      ".proofreading-page__table-status-cell",
    )!;
    expect(Boolean(translation.textContent)).toBe(status !== "NONE");
    await act(async () => translation.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(on_open).toHaveBeenCalledWith('page:["book.pdf",1]');
    if (status === "NONE") {
      expect(status_cell.querySelector("[data-slot='tooltip-trigger']")).toBeNull();
      return;
    }
    const trigger = status_cell.querySelector<HTMLElement>(".proofreading-page__status-icon")!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"][data-open]')).not.toBeNull();
  });
});

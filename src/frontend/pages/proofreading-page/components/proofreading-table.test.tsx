import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofreadingTable } from "@frontend/pages/proofreading-page/components/proofreading-table";
import type {
  ProofreadingItem,
  ProofreadingVisibleItem,
} from "@shared/proofreading/proofreading-types";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => {
      return {
        t: (key: string) => key,
      };
    },
  };
});

// happy-dom 不计算布局，只替换尺寸观测，保留真实表格与虚拟列表交互。
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
function create_visible_item(overrides: Partial<ProofreadingItem>): ProofreadingVisibleItem {
  const item = {
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
  async function render_table(item: ProofreadingVisibleItem): Promise<void> {
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
            active_row_id={null}
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
            on_selection_change={() => {}}
            on_selection_error={() => {}}
            on_open_edit={() => {}}
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
  ])("%s 悬浮预览完整正文，保留换行且不混入姓名", async (column, body) => {
    vi.useFakeTimers();
    await render_table(
      create_visible_item({
        [column]: body,
      }),
    );
    const trigger = container?.querySelector<HTMLElement>(
      `.proofreading-page__table-${column === "src" ? "source" : "translation"}-cell .proofreading-page__table-text`,
    );
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      trigger?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(body);
  });
});

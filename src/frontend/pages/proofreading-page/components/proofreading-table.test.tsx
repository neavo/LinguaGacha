import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofreadingTable } from "@frontend/pages/proofreading-page/components/proofreading-table";
import type {
  ProofreadingItem,
  ProofreadingVisibleItem,
} from "@shared/proofreading/proofreading-types";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type {
  AppTableCellPayload,
  AppTableDragCellPayload,
  AppTableProps,
  AppTableScrollAnchor,
} from "@frontend/widgets/app-table/app-table-types";

type CapturedAppTableProps = AppTableProps<ProofreadingVisibleItem>;

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => {
      return {
        t: (key: string) => key,
      };
    },
  };
});

vi.mock("@frontend/widgets/app-table/app-table", () => {
  return {
    AppTable: (props: CapturedAppTableProps) => {
      const row_model = props.row_model;
      return (
        <div
          data-testid="app-table"
          data-row-count={row_model?.row_count}
          data-loaded-row-ids={row_model?.loaded_row_ids.join(",")}
          data-restore-scroll-row-id={props.restore_scroll_row_id ?? ""}
          data-preserve-scroll-row-id={props.preserve_scroll_anchor?.row_id ?? ""}
          data-preserve-scroll-revision={props.preserve_scroll_anchor?.revision}
        >
          <button
            type="button"
            data-testid="app-table-visible-range"
            onClick={() => row_model?.on_visible_range_change?.({ start: 2, count: 5 })}
          >
            发布可见范围
          </button>
          {props.rows.map((row, row_index) => {
            const row_id = props.get_row_id(row, row_index);
            return (
              <div key={row_id} data-testid={`app-table-row-${row_id}`}>
                {props.columns.map((column) => {
                  const base_payload: AppTableCellPayload<ProofreadingVisibleItem> = {
                    row,
                    row_id,
                    row_index,
                    active: false,
                    selected: false,
                    dragging: false,
                    can_drag: false,
                    presentation: "body",
                  };
                  const cell_content =
                    column.kind === "drag"
                      ? column.render_cell({
                          ...base_payload,
                          drag_handle: null,
                        } satisfies AppTableDragCellPayload<ProofreadingVisibleItem>)
                      : column.render_cell(base_payload);
                  return (
                    <div key={column.id} data-testid={`app-table-cell-${column.id}`}>
                      {cell_content}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      );
    },
  };
});

// 生成状态单元格和表格行共用的最小校对 item。
function create_item(overrides: Partial<ProofreadingItem> = {}): ProofreadingItem {
  return {
    item_id: 1,
    file_path: "chapter01.txt",
    row_number: 1,
    src: "foo",
    dst: "bar",
    name_src: null,
    name_dst: null,
    status: "PROCESSED",
    retry_count: 0,
    warnings: ["GLOSSARY"],
    warning_fragments_by_code: {},
    glossary_applications: [],
    ...overrides,
  };
}

// 构造带 row_id 的校对表格行，便于断言 row_model 公开载荷。
function create_visible_item(
  item_id: number,
  overrides: Partial<ProofreadingItem> = {},
): ProofreadingVisibleItem {
  const item = {
    ...create_item(),
    ...overrides,
    item_id,
    row_id: String(item_id),
    compressed_src: `src-${item_id.toString()}`,
    compressed_dst: `dst-${item_id.toString()}`,
  };
  return {
    row_id: String(item_id),
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
  });

  async function render_table(
    item: ProofreadingVisibleItem,
    options: {
      visible_row_count?: number;
      on_visible_range_change?: (range: { start: number; count: number }) => void;
      restore_scroll_row_id?: string | null;
      preserve_scroll_anchor?: AppTableScrollAnchor;
    } = {},
  ): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ProofreadingTable
            items={[item]}
            visible_row_count={options.visible_row_count ?? 1}
            sort_state={null}
            selected_row_ids={[]}
            active_row_id={null}
            anchor_row_id={null}
            retranslating_row_ids={[]}
            readonly={false}
            get_row_at_index={() => undefined}
            get_row_id_at_index={() => undefined}
            resolve_row_index={() => undefined}
            resolve_row_index_async={async () => undefined}
            resolve_row_ids_range={async () => []}
            on_visible_range_change={options.on_visible_range_change ?? (() => {})}
            restore_scroll_row_id={options.restore_scroll_row_id ?? "1"}
            preserve_scroll_anchor={options.preserve_scroll_anchor ?? { row_id: "1", revision: 3 }}
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

  it("向 AppTable 透传远端行模型与滚动锚点，并回流可见范围", async () => {
    const on_visible_range_change = vi.fn();
    await render_table(create_visible_item(1), {
      visible_row_count: 10,
      on_visible_range_change,
      restore_scroll_row_id: "8",
      preserve_scroll_anchor: { row_id: "7", revision: 4 },
    });

    const table = container?.querySelector('[data-testid="app-table"]');
    expect(table?.getAttribute("data-row-count")).toBe("10");
    expect(table?.getAttribute("data-loaded-row-ids")).toBe("1");
    expect(table?.getAttribute("data-restore-scroll-row-id")).toBe("8");
    expect(table?.getAttribute("data-preserve-scroll-row-id")).toBe("7");
    expect(table?.getAttribute("data-preserve-scroll-revision")).toBe("4");

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="app-table-visible-range"]')
        ?.click();
    });
    expect(on_visible_range_change).toHaveBeenCalledWith({ start: 2, count: 5 });
  });
});

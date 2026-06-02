import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProofreadingStatusCell,
  ProofreadingTable,
} from "@frontend/pages/proofreading-page/components/proofreading-table";
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

// 只声明本测试需要观察的 AppTable 公开载荷。
type CapturedAppTableProps = AppTableProps<ProofreadingVisibleItem>;

// app_table_fixture 保存最近一次 AppTable props，避免测试读取真实表格 DOM 细节。
const { app_table_fixture } = vi.hoisted(() => {
  return {
    app_table_fixture: {
      current_props: null as CapturedAppTableProps | null,
    },
  };
});

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
      app_table_fixture.current_props = props;
      return (
        <div data-testid="app-table">
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
    applied_glossary_terms: [],
    failed_glossary_terms: [],
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

describe("ProofreadingStatusCell", () => {
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

  async function render_cell(
    retranslating: boolean,
    item: ProofreadingItem = create_item(),
  ): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ProofreadingStatusCell item={item} retranslating={retranslating} />
        </TooltipProvider>,
      );
    });

    return container;
  }

  it("重翻中的状态单元格只渲染 Spinner", async () => {
    const rendered = await render_cell(true);

    expect(rendered.querySelector('[role="status"]')).not.toBeNull();
    expect(rendered.querySelectorAll("svg")).toHaveLength(1);
  });

  it("非重翻状态仍按原状态与 warning 图标渲染", async () => {
    const rendered = await render_cell(false);

    expect(rendered.querySelector('[role="status"]')).toBeNull();
    expect(rendered.querySelectorAll("svg")).toHaveLength(2);
  });

  it.each(["RULE_SKIPPED", "DUPLICATED"])("%s 状态渲染中性状态图标", async (status) => {
    const rendered = await render_cell(false, create_item({ status, warnings: [] }));

    expect(rendered.querySelector('[role="status"]')).toBeNull();
    expect(rendered.querySelectorAll("svg")).toHaveLength(1);
    expect(rendered.querySelector(".proofreading-page__status-icon--neutral")).not.toBeNull();
  });
});

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
    app_table_fixture.current_props = null;
  });

  /**
   * 挂载校对表格并记录传给 AppTable 的公开 props。
   */
  async function render_table(anchor: AppTableScrollAnchor): Promise<() => void> {
    const on_visible_range_change = vi.fn<(range: { start: number; count: number }) => void>();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ProofreadingTable
            items={[create_visible_item(1)]}
            visible_row_count={10}
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
            on_visible_range_change={on_visible_range_change}
            restore_scroll_row_id="1"
            preserve_scroll_anchor={anchor}
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

    return () => {
      app_table_fixture.current_props?.row_model?.on_visible_range_change?.({
        start: 2,
        count: 5,
      });
      expect(on_visible_range_change).toHaveBeenCalledWith({
        start: 2,
        count: 5,
      });
    };
  }

  it("向 AppTable 透传滚动恢复锚点和远端窗口模型", async () => {
    const anchor = {
      row_id: "1",
      revision: 3,
    };
    const assert_visible_range_change = await render_table(anchor);

    expect(app_table_fixture.current_props?.preserve_scroll_anchor).toEqual(anchor);
    expect(app_table_fixture.current_props?.restore_scroll_row_id).toBe("1");
    expect(app_table_fixture.current_props?.row_model?.row_count).toBe(10);
    expect(app_table_fixture.current_props?.row_model?.loaded_row_ids).toEqual(["1"]);
    assert_visible_range_change();
  });

  it("有姓名字段时在原文和译文前展示中性姓名胶囊", async () => {
    const anchor = {
      row_id: "1",
      revision: 3,
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ProofreadingTable
            items={[
              create_visible_item(1, {
                name_src: ["虎铁", "保留原名"],
                name_dst: "虎铁译",
              }),
            ]}
            visible_row_count={1}
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
            on_visible_range_change={() => {}}
            restore_scroll_row_id="1"
            preserve_scroll_anchor={anchor}
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

    const source_cell = container.querySelector('[data-testid="app-table-cell-src"]');
    const translation_cell = container.querySelector('[data-testid="app-table-cell-dst"]');
    const source_badge = source_cell?.querySelector(".proofreading-page__table-name-badge");
    const translation_badge = translation_cell?.querySelector(
      ".proofreading-page__table-name-badge",
    );

    expect(source_badge?.getAttribute("data-variant")).toBe("secondary");
    expect(
      source_badge?.querySelector(".proofreading-page__table-name-badge-label"),
    ).not.toBeNull();
    expect(source_badge?.textContent).toBe("虎铁");
    expect(source_cell?.querySelector(".proofreading-page__table-text")?.textContent).toBe("src-1");
    expect(translation_badge?.getAttribute("data-variant")).toBe("secondary");
    expect(translation_badge?.textContent).toBe("虎铁译");
    expect(translation_cell?.querySelector(".proofreading-page__table-text")?.textContent).toBe(
      "dst-1",
    );
  });

  it("姓名数组首项为空时不展示后续槽位姓名", async () => {
    const anchor = {
      row_id: "1",
      revision: 3,
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ProofreadingTable
            items={[
              create_visible_item(1, {
                name_src: ["", "Bob"],
                name_dst: ["", "鲍勃"],
              }),
            ]}
            visible_row_count={1}
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
            on_visible_range_change={() => {}}
            restore_scroll_row_id="1"
            preserve_scroll_anchor={anchor}
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

    const source_cell = container.querySelector('[data-testid="app-table-cell-src"]');
    const translation_cell = container.querySelector('[data-testid="app-table-cell-dst"]');

    expect(source_cell?.querySelector(".proofreading-page__table-name-badge")).toBeNull();
    expect(translation_cell?.querySelector(".proofreading-page__table-name-badge")).toBeNull();
  });
});

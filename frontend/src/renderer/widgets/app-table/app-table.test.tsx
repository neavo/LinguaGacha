import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { build_app_table_reordered_row_ids } from "@/widgets/app-table/app-table-dnd";

const app_table_test_state = vi.hoisted(() => {
  return {
    current_sortable_items: [] as string[],
    virtual_item_indices: null as number[] | null,
    measure: vi.fn(),
    measureElement: vi.fn(),
  };
});

vi.mock("@dnd-kit/sortable", () => {
  const mock_module = {
    SortableContext: (props: { children: unknown; items: Array<string | number> }) => {
      app_table_test_state.current_sortable_items = props.items.map((item) => String(item));
      return props.children;
    },
    sortableKeyboardCoordinates: () => undefined,
    useSortable: () => {
      return {
        attributes: {},
        isDragging: false,
        listeners: {},
        setNodeRef: () => {},
        transform: null,
        transition: undefined,
      };
    },
    verticalListSortingStrategy: {},
  };
  return {
    ...mock_module,
    default: mock_module,
  };
});

vi.mock("@tanstack/react-virtual", () => {
  return {
    useVirtualizer: (options: {
      count: number;
      estimateSize: () => number;
      getItemKey?: (index: number) => string | number;
    }) => {
      const row_height = options.estimateSize();
      const item_indices =
        app_table_test_state.virtual_item_indices ??
        Array.from({ length: options.count }, (_, index) => index);

      return {
        getVirtualItems: () =>
          item_indices.map((index) => {
            return {
              index,
              key: options.getItemKey?.(index) ?? index,
              start: index * row_height,
              end: (index + 1) * row_height,
              size: row_height,
            };
          }),
        getTotalSize: () => options.count * row_height,
        measure: app_table_test_state.measure,
        measureElement: app_table_test_state.measureElement,
        scrollToIndex: () => {},
      };
    },
  };
});

import { AppTable } from "@/widgets/app-table/app-table";
import type {
  AppTableColumn,
  AppTableRowModel,
  AppTableSelectionChange,
} from "@/widgets/app-table/app-table-types";

type TestRow = {
  id: string;
  label: string;
};

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function create_columns(): AppTableColumn<TestRow>[] {
  return [
    {
      kind: "data",
      id: "label",
      title: "名称",
      render_cell: (payload) => {
        return <span>{payload.row.label}</span>;
      },
    },
  ];
}

function create_drag_columns(): AppTableColumn<TestRow>[] {
  return [
    {
      kind: "drag",
      id: "drag",
      render_cell: (payload) => {
        return <span>{payload.drag_handle?.disabled === true ? "不可拖拽" : "可拖拽"}</span>;
      },
    },
    ...create_columns(),
  ];
}

async function render_app_table(
  element: JSX.Element,
): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });

  return {
    container,
    root,
  };
}

function create_default_props(
  overrides?: Partial<Parameters<typeof AppTable<TestRow>>[0]>,
): JSX.Element {
  return (
    <AppTable
      rows={[
        {
          id: "a",
          label: "Alpha",
        },
      ]}
      columns={create_columns()}
      selection_mode="multiple"
      selected_row_ids={[]}
      active_row_id={null}
      anchor_row_id={null}
      sort_state={null}
      drag_enabled={false}
      get_row_id={(row) => row.id}
      on_selection_change={() => {}}
      on_sort_change={() => {}}
      on_reorder={() => {}}
      {...overrides}
    />
  );
}

describe("AppTable row model", () => {
  let mounted_roots: Root[] = [];
  let mounted_containers: HTMLDivElement[] = [];

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    app_table_test_state.current_sortable_items = [];
    app_table_test_state.virtual_item_indices = null;
    app_table_test_state.measure.mockClear();
    app_table_test_state.measureElement.mockClear();
  });

  afterEach(() => {
    mounted_roots.forEach((root) => {
      act(() => {
        root.unmount();
      });
    });
    mounted_containers.forEach((container) => {
      container.remove();
    });
    mounted_roots = [];
    mounted_containers = [];
    vi.unstubAllGlobals();
  });

  async function mount(element: JSX.Element): Promise<HTMLDivElement> {
    const rendered = await render_app_table(element);
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);
    return rendered.container;
  }

  it("未传 row_model 时会用 rows 兼容入口渲染并派发选择", async () => {
    const on_selection_change = vi.fn<(payload: AppTableSelectionChange) => void>();
    const container = await mount(
      create_default_props({
        on_selection_change,
      }),
    );

    expect(container.textContent).toContain("Alpha");

    const row = container.querySelector<HTMLTableRowElement>('[data-row-index="0"]');
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(on_selection_change).toHaveBeenCalledWith({
      selected_row_ids: ["a"],
      active_row_id: "a",
      anchor_row_id: "a",
    });
  });

  it("显式 row_model 会按模型索引读取已加载窗口行并上报可见范围", async () => {
    const on_visible_range_change = vi.fn<(range: { start: number; count: number }) => void>();
    const row_model: AppTableRowModel<TestRow> = {
      row_count: 5,
      loaded_row_ids: ["b"],
      get_row_at_index: (index) => {
        return index === 2
          ? {
              id: "b",
              label: "Beta",
            }
          : undefined;
      },
      get_row_id_at_index: (index) => {
        return index === 2 ? "b" : undefined;
      },
      resolve_row_index: (row_id) => {
        return row_id === "b" ? 2 : undefined;
      },
      on_visible_range_change,
    };
    const container = await mount(
      create_default_props({
        rows: [],
        row_model,
        selected_row_ids: ["b"],
        active_row_id: "b",
        anchor_row_id: "b",
      }),
    );

    expect(container.textContent).toContain("Beta");
    expect(container.querySelector('[data-row-index="2"]')?.getAttribute("data-state")).toBe(
      "selected",
    );
    expect(on_visible_range_change).toHaveBeenCalled();
  });

  it("显式 row_model 下即使传入 drag_enabled 也会降级为不可拖拽", async () => {
    const row_model: AppTableRowModel<TestRow> = {
      row_count: 1,
      loaded_row_ids: ["remote"],
      get_row_at_index: () => {
        return {
          id: "remote",
          label: "Remote",
        };
      },
      get_row_id_at_index: () => "remote",
      resolve_row_index: () => 0,
    };
    const container = await mount(
      create_default_props({
        rows: [],
        columns: create_drag_columns(),
        drag_enabled: true,
        row_model,
      }),
    );

    expect(container.textContent).toContain("不可拖拽");
  });

  it("拖拽启用时 SortableContext 只接收当前虚拟窗口内的行", async () => {
    app_table_test_state.virtual_item_indices = [1, 2];
    await mount(
      create_default_props({
        rows: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
          { id: "d", label: "Delta" },
        ],
        columns: create_drag_columns(),
        drag_enabled: true,
      }),
    );

    expect(app_table_test_state.current_sortable_items).toEqual(["b", "c"]);
  });

  it("完整 row_ids 仍能输出跨可见窗口的重排结果", () => {
    expect(
      build_app_table_reordered_row_ids({
        ordered_row_ids: ["a", "b", "c", "d"],
        moving_row_ids: ["b"],
        over_row_id: "c",
      }),
    ).toEqual(["a", "c", "b", "d"]);
  });

  it("同一 rows 引用重渲染时不会因为内联 get_row_id 变化重建数组模型", async () => {
    const rows = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    const first_get_row_id = vi.fn((row: TestRow) => row.id);
    const second_get_row_id = vi.fn((row: TestRow) => row.id);
    const rendered = await render_app_table(
      create_default_props({
        rows,
        get_row_id: first_get_row_id,
      }),
    );
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);

    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows,
          get_row_id: second_get_row_id,
        }),
      );
      await Promise.resolve();
    });

    expect(first_get_row_id).toHaveBeenCalledTimes(rows.length);
    expect(second_get_row_id).not.toHaveBeenCalled();
  });

  it("可见范围没有变化时不会重复触发 on_visible_range_change", async () => {
    const on_visible_range_change = vi.fn<(range: { start: number; count: number }) => void>();
    const row_model: AppTableRowModel<TestRow> = {
      row_count: 2,
      loaded_row_ids: ["a", "b"],
      get_row_at_index: (index) =>
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ][index],
      get_row_id_at_index: (index) => ["a", "b"][index],
      resolve_row_index: (row_id) => (row_id === "a" ? 0 : row_id === "b" ? 1 : undefined),
      on_visible_range_change,
    };
    const rendered = await render_app_table(
      create_default_props({
        rows: [],
        row_model,
      }),
    );
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);

    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows: [],
          row_model,
          selected_row_ids: ["a"],
          active_row_id: "a",
          anchor_row_id: "a",
        }),
      );
      await Promise.resolve();
    });

    expect(on_visible_range_change).toHaveBeenCalledTimes(1);
  });
});

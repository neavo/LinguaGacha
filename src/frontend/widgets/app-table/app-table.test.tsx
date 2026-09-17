import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragEndEvent, DragStartEvent, DragOverEvent, DragDropManager } from "@dnd-kit/react";

const app_table_test_state = vi.hoisted(() => {
  return {
    virtual_item_indices: null as number[] | null,
    measure: vi.fn(),
    scrollToIndex: vi.fn(),
    on_drag_start: null as ((event: DragStartEvent) => void) | null,
    on_drag_over: null as ((event: DragOverEvent) => void) | null,
    on_drag_end: null as ((event: DragEndEvent) => void) | null,
  };
});

vi.mock("@dnd-kit/react", async (import_original) => {
  const actual = await import_original<typeof import("@dnd-kit/react")>();
  const mock_module = {
    ...actual,
    DragDropProvider: (props: {
      children?: ReactNode;
      onDragStart?: (event: DragStartEvent, manager: DragDropManager) => void;
      onDragOver?: (event: DragOverEvent) => void;
      onDragEnd?: (event: DragEndEvent) => void;
    }) => {
      app_table_test_state.on_drag_start = (event) =>
        props.onDragStart?.(event, { actions: { stop: vi.fn() } } as unknown as DragDropManager);
      app_table_test_state.on_drag_over = props.onDragOver ?? null;
      app_table_test_state.on_drag_end = props.onDragEnd ?? null;
      return props.children;
    },
    DragOverlay: (props: { children?: ReactNode }) => props.children,
  };
  return {
    ...mock_module,
    default: mock_module,
  };
});

vi.mock("@dnd-kit/react/sortable", () => {
  const mock_module = {
    useSortable: () => ({
      isDragSource: false,
      ref: () => {},
      handleRef: () => {},
    }),
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
      getScrollElement: () => HTMLElement | null;
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
        scrollToIndex: (...args: [number, { align: "auto" | "start" }]) => {
          if (options.getScrollElement() === null) {
            return;
          }

          app_table_test_state.scrollToIndex(...args);
        },
      };
    },
  };
});

import { AppTable } from "@frontend/widgets/app-table/app-table";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { AppContextMenuItem } from "@frontend/widgets/app-context-menu";
import type {
  AppTableColumn,
  AppTableRowModel,
  AppTableSelectionChange,
} from "@frontend/widgets/app-table/app-table-types";

type TestRow = {
  id: string;
  label: string;
};

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

/** 夹具提供固定矩形，尺寸观察只保留装配接口。 */
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

/** 两种手柄位置共用行内容，行为断言只观察序号、排序与禁用状态。 */
function create_drag_columns(inline = false): AppTableColumn<TestRow>[] {
  if (inline) return create_columns().map((column) => ({ ...column, drag_handle: true }));
  return [
    {
      kind: "drag",
      id: "drag",
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
      get_row_id={(row) => row.id}
      on_selection_change={() => {}}
      on_sort_change={() => {}}
      {...overrides}
    />
  );
}

function create_remote_row_model(args: {
  rows: TestRow[];
  loaded_indices: number[];
  resolve_row_ids_range?: (range: { start: number; count: number }) => string[] | Promise<string[]>;
}): AppTableRowModel<TestRow> {
  const loaded_index_set = new Set(args.loaded_indices);
  return {
    row_count: args.rows.length,
    loaded_row_ids: args.loaded_indices.flatMap((index) => {
      return args.rows[index]?.id ?? [];
    }),
    get_row_at_index: (index) => {
      return loaded_index_set.has(index) ? args.rows[index] : undefined;
    },
    get_row_id_at_index: (index) => {
      return loaded_index_set.has(index) ? args.rows[index]?.id : undefined;
    },
    resolve_row_index: (row_id) => {
      const index = args.rows.findIndex((row) => row.id === row_id);
      return index >= 0 && loaded_index_set.has(index) ? index : undefined;
    },
    resolve_row_ids_range: args.resolve_row_ids_range,
  };
}

function get_table_host(container: HTMLDivElement): HTMLDivElement {
  const table_host = container.querySelector<HTMLDivElement>(".app-table__scroll-host");
  if (table_host === null) {
    throw new Error("缺少表格滚动宿主。");
  }

  return table_host;
}

function get_table_viewport(container: HTMLDivElement): HTMLElement {
  const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
  if (viewport === null) {
    throw new Error("缺少表格滚动 viewport。");
  }

  return viewport;
}

function create_rows(count: number): TestRow[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `row-${index.toString()}`;
    return {
      id,
      label: `Row ${index.toString()}`,
    };
  });
}

function create_reorder_rows(): TestRow[] {
  return [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
  ];
}

function drag_table_row(active_row_id: string, over_row_id: string): void {
  act(() =>
    app_table_test_state.on_drag_start?.({
      operation: { source: { id: active_row_id } },
    } as DragStartEvent),
  );
  act(() =>
    app_table_test_state.on_drag_over?.({
      operation: { source: { id: active_row_id }, target: { id: over_row_id } },
    } as DragOverEvent),
  );
  act(() =>
    app_table_test_state.on_drag_end?.({
      canceled: false,
      operation: { source: { id: active_row_id }, target: { id: over_row_id } },
    } as DragEndEvent),
  );
}

function read_rendered_row_labels(container: HTMLDivElement): string[] {
  return Array.from(container.querySelectorAll(".app-table__table--body .app-table__row")).map(
    (row) =>
      row.querySelector(".app-table__cell-content")?.textContent ??
      row.querySelector(".app-table__body-cell:not(.app-table__drag-cell)")?.textContent ??
      "",
  );
}

function read_drag_handles(container: HTMLDivElement): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      ".app-table__table--body .app-table__drag-indicator",
    ),
  ];
}

function read_row_numbers(container: HTMLDivElement): string[] {
  return read_drag_handles(container).map(
    (handle) => handle.querySelector(".app-table__drag-row-index")?.textContent ?? "",
  );
}

async function open_row_menu(container: HTMLDivElement, row_index: number): Promise<void> {
  const row = container.querySelector<HTMLElement>(
    `.app-table__table--body [data-row-index="${row_index}"]`,
  );
  expect(row).not.toBeNull();
  await act(async () => {
    row?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }),
    );
  });
}

function get_menu_item(label: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (element) => element.textContent === label,
  );
  expect(item).toBeDefined();
  return item!;
}

function mock_element_rect(element: Element, rect: Pick<DOMRect, "top">): void {
  element.getBoundingClientRect = () => {
    return {
      x: 0,
      y: rect.top,
      top: rect.top,
      left: 0,
      right: 100,
      bottom: rect.top + 36,
      width: 100,
      height: 36,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function create_controlled_promise<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve_promise: (value: T) => void = () => {};
  let reject_promise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolve_promise = resolve;
    reject_promise = reject;
  });

  return {
    promise,
    resolve: resolve_promise,
    reject: reject_promise,
  };
}

async function flush_promises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AppTable", () => {
  let mounted_roots: Root[] = [];
  let mounted_containers: HTMLDivElement[] = [];

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    app_table_test_state.virtual_item_indices = null;
    app_table_test_state.measure.mockClear();
    app_table_test_state.scrollToIndex.mockClear();
    app_table_test_state.on_drag_start = null;
    app_table_test_state.on_drag_end = null;
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

  it("双击目标行与 Enter 活动行共用激活入口，多选保持原有选区", async () => {
    const on_row_activate = vi.fn();
    const on_selection_change = vi.fn();
    const container = await mount(
      create_default_props({
        rows: create_reorder_rows(),
        selected_row_ids: ["a", "b"],
        active_row_id: "b",
        on_row_activate,
        on_selection_change,
      }),
    );
    const host = get_table_host(container);
    await act(async () => {
      host.focus();
      host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      container
        .querySelector('[data-row-index="2"]')
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(on_row_activate.mock.calls).toEqual([["b"], ["c"]]);
    expect(on_selection_change).not.toHaveBeenCalled();
  });

  it("远端活动行离开加载窗口后仍按身份激活", async () => {
    const rows = create_reorder_rows();
    const on_row_activate = vi.fn();
    const container = await mount(
      create_default_props({
        rows: [rows[0]],
        row_model: create_remote_row_model({ rows, loaded_indices: [0] }),
        active_row_id: "b",
        on_row_activate,
      }),
    );
    await act(async () =>
      get_table_host(container).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(on_row_activate).toHaveBeenCalledWith("b");
  });

  it("修饰键、输入法、重复按键和行内输入交由原控件处理", async () => {
    const on_row_activate = vi.fn();
    const container = await mount(
      create_default_props({
        active_row_id: "a",
        on_row_activate,
        columns: [{ kind: "data", id: "input", title: "正文", render_cell: () => <input /> }],
      }),
    );
    const host = get_table_host(container);
    await act(async () => {
      for (const modifiers of [
        { ctrlKey: true },
        { metaKey: true },
        { altKey: true },
        { shiftKey: true },
        { isComposing: true },
        { repeat: true },
      ]) {
        host.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...modifiers }),
        );
      }
      container
        .querySelector("input")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(on_row_activate).not.toHaveBeenCalled();
  });

  it("Enter 打开弹窗后按 Esc 归还表格焦点并继续方向键导航", async () => {
    // 组合真实弹窗，验证焦点归还后表格仍接收键盘操作。
    function TableDialog(): JSX.Element {
      const [open, set_open] = useState(false);
      const [selection, set_selection] = useState<AppTableSelectionChange>({
        selected_row_ids: ["a"],
        active_row_id: "a",
        anchor_row_id: "a",
      });
      return (
        <>
          {create_default_props({
            rows: create_reorder_rows(),
            ...selection,
            on_selection_change: set_selection,
            on_row_activate: () => set_open(true),
          })}
          <AppPageDialog open={open} title="编辑" onClose={() => set_open(false)}>
            <input />
          </AppPageDialog>
        </>
      );
    }
    const container = await mount(<TableDialog />);
    const host = get_table_host(container);
    await act(async () => {
      host.focus();
      host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush_promises();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await flush_promises();
    expect(document.activeElement).toBe(host);
    await act(async () =>
      host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(container.querySelector('[data-active="true"]')?.textContent).toBe("Beta");
  });

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

  it.each([false, true])(
    "松手后立即呈现目标顺序，并由完成后的权威 rows 无缝接管（嵌入手柄=%s）",
    async (inline) => {
      const initial_rows = create_reorder_rows();
      const persist = create_controlled_promise<void>();
      let submitted_row_ids: string[] = [];

      function ReorderFixture(): JSX.Element {
        const [rows, set_rows] = useState(initial_rows);
        return create_default_props({
          rows,
          columns: create_drag_columns(inline),
          on_reorder: async (ordered_row_ids) => {
            submitted_row_ids = ordered_row_ids;
            await persist.promise;
            const row_by_id = new Map(rows.map((row) => [row.id, row]));
            set_rows(ordered_row_ids.map((row_id) => row_by_id.get(row_id)!));
          },
        });
      }

      const container = await mount(<ReorderFixture />);
      drag_table_row("a", "c");

      expect(submitted_row_ids).toEqual(["b", "c", "a"]);
      expect(read_row_numbers(container)).toEqual(["2", "3", "1"]);
      expect(read_rendered_row_labels(container)).toEqual(["Beta", "Gamma", "Alpha"]);
      expect(read_drag_handles(container).every((handle) => handle.disabled)).toBe(true);

      await act(async () => {
        persist.resolve();
        await persist.promise;
        await Promise.resolve();
      });

      expect(read_rendered_row_labels(container)).toEqual(["Beta", "Gamma", "Alpha"]);
      expect(read_row_numbers(container)).toEqual(["1", "2", "3"]);
    },
  );

  it("持久化失败后才恢复权威顺序", async () => {
    const initial_rows = create_reorder_rows();
    const persist = create_controlled_promise<void>();

    function ReorderFixture(): JSX.Element {
      return create_default_props({
        rows: initial_rows,
        columns: create_drag_columns(),
        on_reorder: async () => {
          await persist.promise;
        },
      });
    }

    const container = await mount(<ReorderFixture />);
    drag_table_row("a", "c");

    expect(read_rendered_row_labels(container)).toEqual(["Beta", "Gamma", "Alpha"]);

    await act(async () => {
      persist.reject(new Error("save failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(read_rendered_row_labels(container)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(read_row_numbers(container)).toEqual(["1", "2", "3"]);
  });

  it("拖动中的原行和浮层共用原序号，取消后恢复原行显示（嵌入手柄）", async () => {
    const save = vi.fn(async () => {});
    const container = await mount(
      create_default_props({
        rows: create_reorder_rows(),
        columns: create_drag_columns(true),
        on_reorder: save,
      }),
    );
    act(() =>
      app_table_test_state.on_drag_start?.({
        operation: { source: { id: "a" } },
      } as DragStartEvent),
    );
    act(() =>
      app_table_test_state.on_drag_over?.({
        operation: { source: { id: "a" }, target: { id: "c" } },
      } as DragOverEvent),
    );
    expect(read_rendered_row_labels(container)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(read_row_numbers(container)).toEqual(["2", "3", "1"]);
    expect(
      container.querySelector(".app-table__drag-overlay .app-table__drag-row-index")?.textContent,
    ).toBe("1");
    expect(container.querySelector("[data-overlay-source=true]")?.textContent).toContain("Alpha");
    expect(save).not.toHaveBeenCalled();
    act(() =>
      app_table_test_state.on_drag_end?.({
        canceled: true,
        operation: { source: { id: "a" }, target: { id: "c" } },
      } as DragEndEvent),
    );
    expect(read_row_numbers(container)).toEqual(["1", "2", "3"]);
    expect(container.querySelector("[data-overlay-source]")).toBeNull();
    expect(container.querySelector(".app-table__drag-overlay")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("选中组内拖放没有改变顺序时不提交写入", async () => {
    const on_reorder = vi.fn(async (_ordered_row_ids: string[]) => {});
    await mount(
      create_default_props({
        rows: create_reorder_rows(),
        columns: create_drag_columns(),
        selected_row_ids: ["b", "c"],
        active_row_id: "b",
        anchor_row_id: "b",
        on_reorder,
      }),
    );
    drag_table_row("b", "c");

    expect(on_reorder).not.toHaveBeenCalled();
  });

  it.each([
    ["top", ["a", "c", "b"], ["Alpha", "Gamma", "Beta"]],
    ["bottom", ["b", "a", "c"], ["Beta", "Alpha", "Gamma"]],
  ] as const)(
    "菜单移至 %s 保留非连续选区的原顺序，并由保存后的 rows 接管",
    async (target, expected_ids, expected_labels) => {
      const persist = create_controlled_promise<void>();
      const on_selection_change = vi.fn();
      let submitted_row_ids: string[] = [];
      function Fixture(): JSX.Element {
        const [rows, set_rows] = useState(create_reorder_rows());
        return create_default_props({
          rows,
          columns: create_drag_columns(),
          selected_row_ids: ["c", "a"],
          active_row_id: "c",
          anchor_row_id: "a",
          on_selection_change,
          on_reorder: async (ids) => {
            submitted_row_ids = ids;
            await persist.promise;
            set_rows(ids.map((id) => rows.find((row) => row.id === id)!));
          },
        });
      }
      const container = await mount(<Fixture />);
      await open_row_menu(container, 2);
      await act(async () => get_menu_item(`app.action.move_to_${target}`).click());
      expect(submitted_row_ids).toEqual(expected_ids);
      expect(read_rendered_row_labels(container)).toEqual(expected_labels);
      expect(read_drag_handles(container).every((handle) => handle.disabled)).toBe(true);
      expect(on_selection_change).not.toHaveBeenCalled();

      // 两个入口共用提交期间的互斥，重新打开菜单也不能重复写入。
      drag_table_row("b", "a");
      await open_row_menu(container, 0);
      expect(get_menu_item("app.action.move_to_top").getAttribute("aria-disabled")).toBe("true");
      expect(get_menu_item("app.action.move_to_bottom").getAttribute("aria-disabled")).toBe("true");
      await act(async () => {
        persist.resolve();
        await persist.promise;
      });
      expect(submitted_row_ids).toEqual(expected_ids);
      expect(read_rendered_row_labels(container)).toEqual(expected_labels);
    },
  );

  it("右键未选行只移动该行，页面处理保存失败后恢复权威顺序", async () => {
    const persist = create_controlled_promise<void>();
    const on_reorder = vi.fn(async () => {
      await persist.promise;
    });
    const on_selection_change = vi.fn();
    const container = await mount(
      create_default_props({
        rows: create_reorder_rows(),
        selected_row_ids: ["a", "b"],
        active_row_id: "a",
        anchor_row_id: "a",
        on_selection_change,
        on_reorder,
      }),
    );
    await open_row_menu(container, 2);
    await act(async () => get_menu_item("app.action.move_to_top").click());
    expect(on_selection_change).toHaveBeenCalledWith({
      selected_row_ids: ["c"],
      active_row_id: "c",
      anchor_row_id: "c",
    });
    expect(on_reorder).toHaveBeenCalledWith(["c", "a", "b"]);
    expect(read_rendered_row_labels(container)).toEqual(["Gamma", "Alpha", "Beta"]);
    // 页面内部已经提示失败，回调正常结束，权威 rows 仍保留原顺序。
    await act(async () => {
      persist.resolve();
      await persist.promise;
    });
    expect(read_rendered_row_labels(container)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it.each([
    { restriction: "sort", inline: false },
    { restriction: "readonly", inline: true },
    { restriction: "remote", inline: true },
  ])("$restriction 状态保留菜单但禁止重排（嵌入手柄=$inline）", async ({ restriction, inline }) => {
    const rows = create_reorder_rows();
    const on_reorder = vi.fn(async () => {});
    const container = await mount(
      create_default_props({
        rows,
        columns: create_drag_columns(inline),
        on_reorder,
        reorder_disabled: restriction === "readonly",
        sort_state: restriction === "sort" ? { column_id: "label", direction: "ascending" } : null,
        row_model:
          restriction === "remote"
            ? create_remote_row_model({ rows, loaded_indices: [0, 1, 2] })
            : undefined,
      }),
    );
    expect(read_drag_handles(container).every((handle) => handle.disabled)).toBe(true);
    await open_row_menu(container, 1);
    const top = get_menu_item("app.action.move_to_top");
    const bottom = get_menu_item("app.action.move_to_bottom");
    expect(top.getAttribute("aria-disabled")).toBe("true");
    expect(bottom.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      top.click();
      bottom.click();
    });
    drag_table_row("b", "a");
    expect(on_reorder).not.toHaveBeenCalled();
  });

  it("全选时两项首尾操作均禁用且不提交写入", async () => {
    const on_reorder = vi.fn(async () => {});
    const container = await mount(
      create_default_props({
        rows: create_reorder_rows(),
        selected_row_ids: ["c", "b", "a"],
        on_reorder,
      }),
    );
    await open_row_menu(container, 1);
    for (const target of ["top", "bottom"]) {
      const item = get_menu_item(`app.action.move_to_${target}`);
      expect(item.getAttribute("aria-disabled")).toBe("true");
      await act(async () => item.click());
    }
    expect(on_reorder).not.toHaveBeenCalled();
  });

  it("业务菜单消费表格裁决的目标，不支持重排时仅显示业务项", async () => {
    const on_action = vi.fn();
    const container = await mount(
      create_default_props({
        rows: create_reorder_rows(),
        selected_row_ids: ["a", "c"],
        render_row_context_menu_items: (payload) => (
          <AppContextMenuItem onClick={() => on_action(payload.target_row_ids)}>
            编辑
          </AppContextMenuItem>
        ),
      }),
    );
    await open_row_menu(container, 2);
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain(
      "app.action.move_to_",
    );
    await act(async () => get_menu_item("编辑").click());
    expect(on_action).toHaveBeenCalledWith(["a", "c"]);
  });

  it("菜单移动到未挂载位置后按行身份滚动并归还表格焦点", async () => {
    const rows = create_rows(30);
    const persist = create_controlled_promise<void>();
    app_table_test_state.virtual_item_indices = [0, 1, 2];
    const container = await mount(
      create_default_props({
        rows,
        on_reorder: async () => {
          await persist.promise;
        },
      }),
    );
    await open_row_menu(container, 1);
    await act(async () => get_menu_item("app.action.move_to_bottom").click());
    await vi.waitFor(() => {
      expect(app_table_test_state.scrollToIndex).toHaveBeenCalledWith(29, { align: "auto" });
      expect(document.activeElement).toBe(get_table_host(container));
    });
    await act(async () => {
      persist.resolve();
      await persist.promise;
    });
  });

  it("Shift 加方向键通过真实表格入口扩展选区并保留锚点", async () => {
    const on_selection_change = vi.fn();
    const container = await mount(
      create_default_props({
        rows: create_reorder_rows(),
        selected_row_ids: ["b"],
        active_row_id: "b",
        anchor_row_id: "b",
        on_selection_change,
      }),
    );
    const host = get_table_host(container);
    await act(async () => {
      host.focus();
      host.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }),
      );
    });
    expect(on_selection_change).toHaveBeenCalledWith({
      selected_row_ids: ["b", "c"],
      active_row_id: "c",
      anchor_row_id: "b",
    });
  });

  it("行内交互标记阻止点击和框选同时改变表格选区", async () => {
    const on_selection_change = vi.fn<(payload: AppTableSelectionChange) => void>();
    const container = await mount(
      create_default_props({
        columns: [
          {
            kind: "data",
            id: "action",
            title: "操作",
            render_cell: () => (
              <button
                data-app-table-ignore-row-click="true"
                data-app-table-ignore-box-select="true"
              >
                操作
              </button>
            ),
          },
        ],
        on_selection_change,
      }),
    );

    const button = container.querySelector("button");
    act(() => {
      button?.click();
      button?.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 1,
          clientY: 1,
        }),
      );
    });

    expect(on_selection_change).not.toHaveBeenCalled();
    expect(container.querySelector(".app-table__selection-box")).toBeNull();
  });

  it("恢复页面状态时会把本地表格的选中行滚入视口", async () => {
    app_table_test_state.virtual_item_indices = [0];

    await mount(
      create_default_props({
        rows: [
          {
            id: "a",
            label: "Alpha",
          },
          {
            id: "b",
            label: "Beta",
          },
          {
            id: "c",
            label: "Gamma",
          },
        ],
        selected_row_ids: ["c"],
        active_row_id: "c",
        anchor_row_id: "c",
        scroll_to_row: { row_id: "c", revision: 0 },
      }),
    );

    expect(app_table_test_state.scrollToIndex).toHaveBeenCalledWith(2, {
      align: "start",
    });
  });

  it("恢复页面状态时会通过远端 row_model 解析未加载选中行的位置", async () => {
    app_table_test_state.virtual_item_indices = [0];
    const resolve_row_index_async = vi.fn(async () => 2);
    const rows = [
      {
        id: "a",
        label: "Alpha",
      },
      {
        id: "b",
        label: "Beta",
      },
      {
        id: "c",
        label: "Gamma",
      },
    ];

    await mount(
      create_default_props({
        rows: [rows[0] as TestRow],
        row_model: {
          ...create_remote_row_model({
            rows,
            loaded_indices: [0],
          }),
          resolve_row_index_async,
        },
        selected_row_ids: ["c"],
        active_row_id: "c",
        anchor_row_id: "c",
        scroll_to_row: { row_id: "c", revision: 0 },
      }),
    );
    await flush_promises();

    expect(resolve_row_index_async).toHaveBeenCalledWith("c");
    expect(app_table_test_state.scrollToIndex).toHaveBeenCalledWith(2, {
      align: "start",
    });
  });

  it("过期的异步恢复请求返回后不会覆盖新的同步滚动位置", async () => {
    app_table_test_state.virtual_item_indices = [0];
    const restore_request = create_controlled_promise<number | undefined>();
    const resolve_row_index_async = vi.fn(() => restore_request.promise);
    const rows = [
      {
        id: "a",
        label: "Alpha",
      },
      {
        id: "c",
        label: "Gamma",
      },
      {
        id: "b",
        label: "Beta",
      },
    ];
    const rendered = await render_app_table(
      create_default_props({
        rows: [rows[0] as TestRow],
        row_model: {
          ...create_remote_row_model({
            rows,
            loaded_indices: [0],
          }),
          resolve_row_index_async,
        },
        selected_row_ids: ["c"],
        active_row_id: "c",
        anchor_row_id: "c",
        scroll_to_row: { row_id: "c", revision: 0 },
      }),
    );
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);

    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows: [rows[0] as TestRow],
          row_model: create_remote_row_model({
            rows,
            loaded_indices: [1],
          }),
          selected_row_ids: ["c"],
          active_row_id: "c",
          anchor_row_id: "c",
          scroll_to_row: { row_id: "c", revision: 1 },
        }),
      );
      await Promise.resolve();
    });

    expect(app_table_test_state.scrollToIndex).toHaveBeenCalledWith(1, {
      align: "start",
    });

    restore_request.resolve(2);
    await flush_promises();

    expect(app_table_test_state.scrollToIndex).not.toHaveBeenCalledWith(2, {
      align: "start",
    });
  });

  it("目标行或滚动版本变化时都会重新定位", async () => {
    app_table_test_state.virtual_item_indices = [0];
    const rows = create_rows(3);
    const rendered = await render_app_table(
      create_default_props({
        rows,
        scroll_to_row: { row_id: "row-2", revision: 1 },
      }),
    );
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);

    expect(app_table_test_state.scrollToIndex).toHaveBeenCalledTimes(1);

    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows,
          scroll_to_row: { row_id: "row-1", revision: 1 },
        }),
      );
      await Promise.resolve();
    });

    expect(app_table_test_state.scrollToIndex).toHaveBeenCalledTimes(2);
    expect(app_table_test_state.scrollToIndex).toHaveBeenLastCalledWith(1, { align: "start" });

    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows,
          scroll_to_row: { row_id: "row-1", revision: 2 },
        }),
      );
      await Promise.resolve();
    });

    expect(app_table_test_state.scrollToIndex).toHaveBeenCalledTimes(3);
  });

  it("刷新锚点会捕获已挂载行偏移并在数据更新后恢复", async () => {
    app_table_test_state.virtual_item_indices = [10];
    const rows = create_rows(20);
    const rendered = await render_app_table(
      create_default_props({
        rows,
        preserve_scroll_anchor: { row_id: null, revision: 0 },
      }),
    );
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);
    const viewport = get_table_viewport(rendered.container);
    Object.defineProperty(viewport, "clientHeight", { value: 72, configurable: true });
    viewport.scrollTop = 200;
    mock_element_rect(viewport, { top: 100 });
    const anchor_row =
      rendered.container.querySelector<HTMLTableRowElement>('[data-row-index="10"]');
    if (anchor_row === null) {
      throw new Error("缺少测试锚点行。");
    }
    mock_element_rect(anchor_row, { top: 112 });

    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows,
          preserve_scroll_anchor: { row_id: "row-10", revision: 1 },
        }),
      );
      await Promise.resolve();
    });
    viewport.scrollTop = 0;
    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows: rows.map((row) => ({ ...row, label: `${row.label} updated` })),
          preserve_scroll_anchor: { row_id: "row-10", revision: 1 },
        }),
      );
      await Promise.resolve();
    });

    expect(viewport.scrollTop).toBe(348);
  });

  it("刷新锚点行未挂载时会用 row_height 和索引恢复偏移", async () => {
    app_table_test_state.virtual_item_indices = [0];
    const rows = create_rows(20);
    const row_model = create_remote_row_model({
      rows,
      loaded_indices: [0, 10],
    });
    const rendered = await render_app_table(
      create_default_props({
        rows: [],
        row_model,
        row_height: 40,
        preserve_scroll_anchor: { row_id: null, revision: 0 },
      }),
    );
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);
    const viewport = get_table_viewport(rendered.container);
    Object.defineProperty(viewport, "clientHeight", { value: 100, configurable: true });
    viewport.scrollTop = 300;

    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows: [],
          row_model,
          row_height: 40,
          preserve_scroll_anchor: { row_id: "row-10", revision: 1 },
        }),
      );
      await Promise.resolve();
    });
    viewport.scrollTop = 0;
    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows: [],
          row_model,
          row_height: 40,
          preserve_scroll_anchor: { row_id: "row-10", revision: 1 },
        }),
      );
      await Promise.resolve();
    });

    expect(viewport.scrollTop).toBe(300);
  });

  it("刷新锚点行消失时不会写入错误滚动位置", async () => {
    app_table_test_state.virtual_item_indices = [0];
    const rows = create_rows(20);
    const row_model = create_remote_row_model({
      rows,
      loaded_indices: [0, 10],
    });
    const rendered = await render_app_table(
      create_default_props({
        rows: [],
        row_model,
        row_height: 40,
        preserve_scroll_anchor: { row_id: null, revision: 0 },
      }),
    );
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);
    const viewport = get_table_viewport(rendered.container);
    Object.defineProperty(viewport, "clientHeight", { value: 100, configurable: true });
    viewport.scrollTop = 300;

    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows: [],
          row_model,
          row_height: 40,
          preserve_scroll_anchor: { row_id: "row-10", revision: 1 },
        }),
      );
      await Promise.resolve();
    });
    viewport.scrollTop = 0;
    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows: [],
          row_model: create_remote_row_model({
            rows,
            loaded_indices: [0],
          }),
          row_height: 40,
          preserve_scroll_anchor: { row_id: "row-10", revision: 1 },
        }),
      );
      await Promise.resolve();
    });

    expect(viewport.scrollTop).toBe(0);
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
        columns: create_drag_columns(),
        row_model,
        selected_row_ids: ["b"],
        active_row_id: "b",
        anchor_row_id: "b",
      }),
    );

    expect(container.textContent).toContain("Beta");
    expect(read_row_numbers(container)).toEqual(["3"]);
    expect(container.querySelector('[data-row-index="2"]')?.getAttribute("data-state")).toBe(
      "selected",
    );
    expect(on_visible_range_change).toHaveBeenCalled();
  });

  it("远程 row_model 只加载单行时 Ctrl/Cmd+A 会选中完整视图行集", async () => {
    app_table_test_state.virtual_item_indices = [2];
    const rows = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    const on_selection_change = vi.fn<(payload: AppTableSelectionChange) => void>();
    const resolve_row_ids_range = vi.fn((range: { start: number; count: number }) => {
      return rows.slice(range.start, range.start + range.count).map((row) => row.id);
    });
    const container = await mount(
      create_default_props({
        rows: [],
        row_model: create_remote_row_model({
          rows,
          loaded_indices: [2],
          resolve_row_ids_range,
        }),
        on_selection_change,
      }),
    );

    get_table_host(container).dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "a",
        ctrlKey: true,
      }),
    );
    await flush_promises();

    expect(resolve_row_ids_range).toHaveBeenCalledWith({
      start: 0,
      count: 3,
    });
    expect(on_selection_change).toHaveBeenCalledWith({
      selected_row_ids: ["a", "b", "c"],
      active_row_id: "a",
      anchor_row_id: "a",
    });
  });

  it("远程全选请求过期后不会写回当前选区", async () => {
    app_table_test_state.virtual_item_indices = [0];
    const rows = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    const next_rows = [{ id: "x", label: "Next" }];
    const on_selection_change = vi.fn<(payload: AppTableSelectionChange) => void>();
    const selection_request = create_controlled_promise<string[]>();
    const resolve_row_ids_range = vi.fn(() => {
      return selection_request.promise;
    });
    const rendered = await render_app_table(
      create_default_props({
        rows: [],
        row_model: create_remote_row_model({
          rows,
          loaded_indices: [0],
          resolve_row_ids_range,
        }),
        on_selection_change,
      }),
    );
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);

    get_table_host(rendered.container).dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "a",
        ctrlKey: true,
      }),
    );
    expect(resolve_row_ids_range).toHaveBeenCalledWith({
      start: 0,
      count: 2,
    });

    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows: [],
          row_model: create_remote_row_model({
            rows: next_rows,
            loaded_indices: [0],
          }),
          on_selection_change,
        }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      selection_request.resolve(["a", "b"]);
      await selection_request.promise;
    });
    await flush_promises();

    expect(on_selection_change).not.toHaveBeenCalled();
  });

  it("远程选择请求过期失败时不会触发错误回调", async () => {
    app_table_test_state.virtual_item_indices = [0];
    const rows = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    const on_selection_change = vi.fn<(payload: AppTableSelectionChange) => void>();
    const on_selection_error = vi.fn<(error: unknown) => void>();
    const selection_error = new Error("旧视图读取失败");
    const selection_request = create_controlled_promise<string[]>();
    const rendered = await render_app_table(
      create_default_props({
        rows: [],
        row_model: create_remote_row_model({
          rows,
          loaded_indices: [0],
          resolve_row_ids_range: () => selection_request.promise,
        }),
        on_selection_change,
        on_selection_error,
      }),
    );
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);

    get_table_host(rendered.container).dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "a",
        ctrlKey: true,
      }),
    );
    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows: [],
          row_model: create_remote_row_model({
            rows: [{ id: "x", label: "Next" }],
            loaded_indices: [0],
          }),
          on_selection_change,
          on_selection_error,
        }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      selection_request.reject(selection_error);
      await selection_request.promise.catch(() => undefined);
    });
    await flush_promises();

    expect(on_selection_change).not.toHaveBeenCalled();
    expect(on_selection_error).not.toHaveBeenCalled();
  });

  it("点击锚点后滚动到另一窗口，Shift 点击会选中完整跨窗口范围", async () => {
    const rows = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
      { id: "e", label: "Epsilon" },
    ];
    const on_selection_change = vi.fn<(payload: AppTableSelectionChange) => void>();
    const resolve_row_ids_range = vi.fn((range: { start: number; count: number }) => {
      return rows.slice(range.start, range.start + range.count).map((row) => row.id);
    });
    app_table_test_state.virtual_item_indices = [0];
    const rendered = await render_app_table(
      create_default_props({
        rows: [],
        row_model: create_remote_row_model({
          rows,
          loaded_indices: [0],
          resolve_row_ids_range,
        }),
        on_selection_change,
      }),
    );
    mounted_roots.push(rendered.root);
    mounted_containers.push(rendered.container);

    const first_row = rendered.container.querySelector<HTMLTableRowElement>('[data-row-index="0"]');
    expect(first_row).not.toBeNull();
    act(() => {
      first_row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    app_table_test_state.virtual_item_indices = [4];
    await act(async () => {
      rendered.root.render(
        create_default_props({
          rows: [],
          row_model: create_remote_row_model({
            rows,
            loaded_indices: [4],
            resolve_row_ids_range,
          }),
          selected_row_ids: ["a"],
          active_row_id: "a",
          anchor_row_id: "a",
          on_selection_change,
        }),
      );
      await Promise.resolve();
    });

    const target_row =
      rendered.container.querySelector<HTMLTableRowElement>('[data-row-index="4"]');
    expect(target_row).not.toBeNull();
    act(() => {
      target_row?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          shiftKey: true,
        }),
      );
    });
    await flush_promises();

    expect(resolve_row_ids_range).toHaveBeenLastCalledWith({
      start: 0,
      count: 5,
    });
    expect(on_selection_change).toHaveBeenLastCalledWith({
      selected_row_ids: ["a", "b", "c", "d", "e"],
      active_row_id: "e",
      anchor_row_id: "a",
    });
  });

  it("远程选择读取失败时保留当前选区并触发错误回调", async () => {
    app_table_test_state.virtual_item_indices = [0];
    const on_selection_change = vi.fn<(payload: AppTableSelectionChange) => void>();
    const on_selection_error = vi.fn<(error: unknown) => void>();
    const selection_error = new Error("读取失败");
    const rows = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    const container = await mount(
      create_default_props({
        rows: [],
        row_model: create_remote_row_model({
          rows,
          loaded_indices: [0],
          resolve_row_ids_range: async () => {
            throw selection_error;
          },
        }),
        selected_row_ids: ["a"],
        active_row_id: "a",
        anchor_row_id: "a",
        on_selection_change,
        on_selection_error,
      }),
    );

    get_table_host(container).dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "a",
        ctrlKey: true,
      }),
    );
    await flush_promises();

    expect(on_selection_change).not.toHaveBeenCalled();
    expect(on_selection_error).toHaveBeenCalledWith(selection_error);
  });

  it("无 resolve_row_ids_range 的普通数组表格仍按 rows 执行全选", async () => {
    const on_selection_change = vi.fn<(payload: AppTableSelectionChange) => void>();
    const container = await mount(
      create_default_props({
        rows: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
        on_selection_change,
      }),
    );

    get_table_host(container).dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "a",
        metaKey: true,
      }),
    );
    await flush_promises();

    expect(on_selection_change).toHaveBeenCalledWith({
      selected_row_ids: ["a", "b"],
      active_row_id: "a",
      anchor_row_id: "a",
    });
  });

  it("显式 row_model 下即使提供重排回调也会降级为不可拖拽", async () => {
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
        on_reorder: async () => {},
        row_model,
      }),
    );

    expect(read_drag_handles(container).every((handle) => handle.disabled)).toBe(true);
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

import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { SORTABLE_PROVIDER_OPTIONS } from "@frontend/widgets/interactions/sortable";
import { useReorder } from "@frontend/widgets/interactions/use-reorder";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@frontend/shadcn/classnames";
import { ArrowDownToLine, ArrowUpToLine } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
  AppContextMenuSeparator,
} from "@frontend/widgets/app-context-menu";
import { ScrollArea } from "@frontend/shadcn/scroll-area";
import { Table, TableBody, TableHeader, TableRow } from "@frontend/shadcn/table";
import "@frontend/widgets/app-table/app-table.css";
import { move_ordered_ids } from "@frontend/widgets/interactions/reorder";
import {
  AppTableSortableRow,
  AppTableRowCells,
  AppTableHeadCell,
  AppTablePlaceholderRow,
  AppTableSpacerRow,
} from "@frontend/widgets/app-table/app-table-render";
import {
  are_app_table_selection_states_equal,
  build_app_table_box_selection_change,
  build_app_table_click_selection_change,
  build_app_table_context_selection_change,
  build_app_table_select_all_selection_change,
  normalize_app_table_selection_state,
  resolve_app_table_target_row_ids,
} from "@frontend/widgets/app-table/app-table-selection";
import type {
  AppTableProps,
  AppTableRowModel,
  AppTableRowEvent,
  AppTableScrollTarget,
  AppTableSelectionState,
} from "@frontend/widgets/app-table/app-table-types";
import {
  APP_TABLE_DEFAULT_ROW_HEIGHT,
  APP_TABLE_DEFAULT_VIRTUAL_OVERSCAN,
  build_app_table_placeholder_fill,
  build_app_table_spacer_heights,
  resolve_app_table_row_zebra,
} from "@frontend/widgets/app-table/app-table-virtualization";

type SelectionBoxState = {
  origin_x: number;
  origin_y: number;
  current_x: number;
  current_y: number;
  moved: boolean;
};

// 区分普通键盘滚动和 session 恢复滚动的对齐策略。
type AppTableScrollAlignment = "nearest" | "start";

// 通用 data 标记由表格统一解释，页面不再复制点击与框选的排除选择器。
const APP_TABLE_IGNORE_BOX_SELECTION_SELECTOR = [
  '[data-app-table-ignore-box-select="true"]',
  '[data-slot="scroll-area-scrollbar"]',
  '[data-slot="scroll-area-thumb"]',
  '[data-slot="scroll-area-corner"]',
].join(", ");

/** 行内控件和滚动条由自身处理指针输入，避免同时开始框选。 */
function should_ignore_app_table_box_selection(target_element: HTMLElement): boolean {
  return target_element.closest(APP_TABLE_IGNORE_BOX_SELECTION_SELECTOR) !== null;
}

type AppTableVisibleRange = {
  start: number;
  count: number;
};

// 保存刷新前捕获的视觉偏移，等待下一次提交后按新 row index 回填 scrollTop。
type PendingScrollAnchor = {
  row_id: string;
  offset: number;
  revision: number;
  captured_commit: number;
};

/** 为完整数组建立身份索引，供选择、虚拟化和重排共用。 */
function create_array_row_model<Row>(
  rows: Row[],
  get_row_id: (row: Row, index: number) => string,
): AppTableRowModel<Row> {
  const loaded_row_ids = rows.map((row, index) => get_row_id(row, index));
  const row_index_by_id = new Map(
    loaded_row_ids.map((row_id, index) => {
      return [row_id, index] as const;
    }),
  );

  return {
    row_count: rows.length,
    loaded_row_ids,
    get_row_at_index: (index) => rows[index],
    get_row_id_at_index: (index) => loaded_row_ids[index],
    resolve_row_index: (row_id) => row_index_by_id.get(row_id),
  };
}

/** 把虚拟行范围转换为页面窗口请求，空视口不发请求。 */
function normalize_visible_range(virtual_rows: Array<VirtualItem>): AppTableVisibleRange | null {
  if (virtual_rows.length === 0) {
    return null;
  }

  const first_index = virtual_rows[0]?.index ?? 0;
  const last_index = virtual_rows.at(-1)?.index ?? first_index;
  return {
    start: first_index,
    count: last_index - first_index + 1,
  };
}

/** 将任意拖动方向归一化为视口坐标中的矩形。 */
function build_selection_box_rect(selection_box: SelectionBoxState): DOMRect {
  return new DOMRect(
    Math.min(selection_box.origin_x, selection_box.current_x),
    Math.min(selection_box.origin_y, selection_box.current_y),
    Math.abs(selection_box.current_x - selection_box.origin_x),
    Math.abs(selection_box.current_y - selection_box.origin_y),
  );
}
/** 按已挂载行的实际矩形计算框选命中。 */
function intersects_selection_box(
  row_element: HTMLTableRowElement,
  selection_box: SelectionBoxState,
): boolean {
  const row_rect = row_element.getBoundingClientRect();
  const selection_rect = build_selection_box_rect(selection_box);

  return !(
    selection_rect.right < row_rect.left ||
    selection_rect.left > row_rect.right ||
    selection_rect.bottom < row_rect.top ||
    selection_rect.top > row_rect.bottom
  );
}

/** 将视口坐标转换为滚动宿主内的框选样式。 */
function normalize_selection_box_style(
  host_element: HTMLDivElement | null,
  selection_box: SelectionBoxState | null,
): CSSProperties | undefined {
  if (host_element === null || selection_box === null || !selection_box.moved) {
    return undefined;
  }

  const host_rect = host_element.getBoundingClientRect();
  const start_x = selection_box.origin_x - host_rect.left;
  const start_y = selection_box.origin_y - host_rect.top;
  const end_x = selection_box.current_x - host_rect.left;
  const end_y = selection_box.current_y - host_rect.top;

  return {
    left: Math.min(start_x, end_x),
    top: Math.min(start_y, end_y),
    width: Math.abs(end_x - start_x),
    height: Math.abs(end_y - start_y),
  };
}

/** 在动画帧中直接更新框选层，避免每次指针移动触发 React 渲染。 */
function sync_selection_box_element_style(args: {
  host_element: HTMLDivElement | null;
  selection_box_element: HTMLDivElement | null;
  selection_box: SelectionBoxState | null;
}): void {
  if (args.selection_box_element === null) {
    return;
  }

  const next_style = normalize_selection_box_style(args.host_element, args.selection_box);
  if (next_style === undefined) {
    args.selection_box_element.style.display = "none";
    return;
  }

  args.selection_box_element.style.display = "block";
  args.selection_box_element.style.left = `${String(next_style.left ?? 0)}px`;
  args.selection_box_element.style.top = `${String(next_style.top ?? 0)}px`;
  args.selection_box_element.style.width = `${String(next_style.width ?? 0)}px`;
  args.selection_box_element.style.height = `${String(next_style.height ?? 0)}px`;
}

/** 统一 Windows Ctrl 与 macOS Command 的多选语义。 */
function has_primary_keyboard_modifier(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): boolean {
  return event.ctrlKey || event.metaKey;
}

// 表格只处理自身焦点，输入法确认和行内控件的按键由原入口消费。
function should_handle_table_keydown(event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  return !event.nativeEvent.isComposing && event.target === event.currentTarget;
}

type AppTableKeyboardNavigationAction = "previous" | "next" | "first" | "last";

/** 导航在列表首尾停止；没有活动行时按方向选择首行或末行。 */
function resolve_keyboard_target_index(args: {
  row_count: number;
  current_index: number | null;
  action: AppTableKeyboardNavigationAction;
}): number {
  if (args.row_count <= 0) {
    return -1;
  }

  if (args.action === "first") {
    return 0;
  } else if (args.action === "last") {
    return args.row_count - 1;
  } else if (args.action === "previous") {
    return args.current_index === null ? args.row_count - 1 : Math.max(args.current_index - 1, 0);
  } else {
    return args.current_index === null ? 0 : Math.min(args.current_index + 1, args.row_count - 1);
  }
}

/** 将窗口请求限制在现有行数内，负长度按空窗口处理。 */
function normalize_row_range(
  row_count: number,
  start: number,
  count: number,
): AppTableVisibleRange {
  const normalized_start = Math.max(0, Math.min(start, row_count));
  const normalized_end = Math.max(
    normalized_start,
    Math.min(normalized_start + Math.max(count, 0), row_count),
  );

  return {
    start: normalized_start,
    count: normalized_end - normalized_start,
  };
}
/** 统一数组和远端窗口的选择交互；页面仍拥有数据与持久化。 */
export function AppTable<Row>(props: AppTableProps<Row>): JSX.Element {
  const { t } = useI18n();
  const {
    rows,
    columns,
    selection_mode,
    selected_row_ids,
    active_row_id,
    anchor_row_id,
    sort_state,
    get_row_id,
    row_model: row_model_prop,
    scroll_to_row,
    preserve_scroll_anchor,
    get_row_can_drag,
    on_selection_change,
    on_selection_error,
    on_sort_change,
    on_reorder,
    reorder_disabled = false,
    on_row_activate,
    render_row_context_menu_items,
    box_selection_enabled: box_selection_enabled_prop,
    virtual_overscan,
    row_height: row_height_prop,
    placeholder_row_strategy,
    className,
    table_class_name,
    row_class_name,
  } = props;
  const table_scroll_host_ref = useRef<HTMLDivElement | null>(null);
  const table_body_ref = useRef<HTMLTableSectionElement | null>(null);
  const selection_box_element_ref = useRef<HTMLDivElement | null>(null);
  const row_elements_ref = useRef(new Map<string, HTMLTableRowElement>());
  const selection_box_ref = useRef<SelectionBoxState | null>(null);
  const selection_box_ids_ref = useRef<string[]>([]);
  const selection_origin_state_ref = useRef<AppTableSelectionState | null>(null);
  const selection_preview_state_ref = useRef<AppTableSelectionState | null>(null);
  const selection_frame_id_ref = useRef<number | null>(null);
  const visible_range_signature_ref = useRef("");
  const suppress_click_ref = useRef(false);
  const active_row_index_ref = useRef<number | null>(null);
  const anchor_row_index_ref = useRef<number | null>(null);
  const selection_request_epoch_ref = useRef(0);
  // 让迟到的异步 row index 结果不能覆盖更新后的定位目标。
  const scroll_to_row_request_epoch_ref = useRef(0);
  // 目标行和版本共同标识请求：异行同版本与同行新版本都必须重新定位。
  const consumed_scroll_to_row_ref = useRef<AppTableScrollTarget | null>(null);
  // 记录已捕获的刷新锚点版本，避免重复捕获同一轮刷新。
  const preserve_scroll_capture_revision_ref = useRef(0);
  // 让迟到的异步锚点解析不能覆盖更新后的刷新锚点。
  const preserve_scroll_request_epoch_ref = useRef(0);
  // 在刷新前后两次 layout commit 之间传递滚动偏移。
  const pending_scroll_anchor_ref = useRef<PendingScrollAnchor | null>(null);
  // 区分捕获与恢复是否发生在同一次 layout commit。
  const layout_commit_id_ref = useRef(0);
  // 表格虚拟计算的唯一行高来源，CSS 变量和虚拟定位共用它。
  const row_height = row_height_prop ?? APP_TABLE_DEFAULT_ROW_HEIGHT;
  const [viewport_element, set_viewport_element] = useState<HTMLElement | null>(null);
  const [viewport_height, set_viewport_height] = useState(row_height);
  const [drag_overlay_width, set_drag_overlay_width] = useState<number | null>(null);
  const source_row_model = useMemo(
    () => create_array_row_model(rows, get_row_id),
    [rows, get_row_id],
  );
  const source_row_ids = source_row_model.loaded_row_ids;
  const disabled_row_ids = useMemo(
    () =>
      rows.flatMap((row, index) =>
        get_row_can_drag?.(row, index) === false ? [source_row_ids[index]!] : [],
      ),
    [rows, get_row_can_drag, source_row_ids],
  );
  const reorder = useReorder({
    ids: source_row_ids,
    disabled:
      reorder_disabled ||
      sort_state !== null ||
      row_model_prop !== undefined ||
      on_reorder === undefined,
    disabled_ids: disabled_row_ids,
    moving_ids: (source_id) =>
      resolve_app_table_target_row_ids(source_id, selected_row_ids, selection_mode),
    on_reorder,
  });
  const active_drag_row_id = reorder.active_id;
  const source_row_numbers = useMemo(
    () =>
      reorder.source_ids === null
        ? null
        : new Map(reorder.source_ids.map((id, index) => [id, index + 1])),
    [reorder.source_ids],
  );
  // 有效重排覆盖完整身份集合；普通/远端窗口则沿用完整视图索引。
  function resolve_row_number(row_id: string, row_index: number): number {
    return source_row_numbers === null ? row_index + 1 : source_row_numbers.get(row_id)!;
  }

  // 菜单移动按身份跟随目标；保存失败后也能在权威顺序中重新定位。
  const reorder_scroll_row_id_ref = useRef<string | null>(null);
  const [selection_box_active, set_selection_box_active] = useState(false);
  const [selection_preview_state, set_selection_preview_state] =
    useState<AppTableSelectionState | null>(null);

  // 重排 Hook 已保证完整身份集合；这里只投影行内容，不重复校验或复制回退路径。
  const array_row_model = useMemo(() => {
    if (reorder.ordered_ids === source_row_ids) return source_row_model;
    const ordered_rows = reorder.ordered_ids.map(
      (id) => rows[source_row_model.resolve_row_index(id)!]!,
    );
    return create_array_row_model(ordered_rows, (_row, index) => reorder.ordered_ids[index]!);
  }, [reorder.ordered_ids, rows, source_row_ids, source_row_model]);
  const row_model = row_model_prop ?? array_row_model;
  const row_count = row_model.row_count;
  const row_ids = row_model.loaded_row_ids;
  /** 从当前展示模型读取正文，预览顺序与内容更新共用入口。 */
  const resolve_row_at_index = useCallback(
    (index: number): Row | undefined => {
      return row_model.get_row_at_index(index);
    },
    [row_model],
  );
  /** 为虚拟行提供当前展示位置对应的稳定身份。 */
  const resolve_row_id_at_index = useCallback(
    (index: number): string | undefined => {
      return row_model.get_row_id_at_index(index);
    },
    [row_model],
  );
  const row_index_by_id = useMemo(() => {
    const next_index_by_id = new Map<string, number>();
    [...row_ids, ...selected_row_ids, active_row_id, anchor_row_id].forEach((row_id) => {
      if (row_id === null || row_id === undefined) {
        return;
      }

      const row_index = row_model.resolve_row_index(row_id);
      if (row_index !== undefined) {
        next_index_by_id.set(row_id, row_index);
      }
    });
    return next_index_by_id;
  }, [active_row_id, anchor_row_id, row_ids, row_model, selected_row_ids]);
  const selection_state = useMemo(() => {
    const selection_scope_row_ids = row_model_prop === undefined ? row_ids : null;
    return normalize_app_table_selection_state(
      {
        selected_row_ids,
        active_row_id,
        anchor_row_id,
      },
      selection_scope_row_ids,
    );
  }, [active_row_id, anchor_row_id, row_ids, row_model_prop, selected_row_ids]);
  const rendered_selection_state = selection_preview_state ?? selection_state;
  const selected_row_id_set = useMemo(() => {
    return new Set(rendered_selection_state.selected_row_ids);
  }, [rendered_selection_state.selected_row_ids]);
  const drag_column_present = columns.some(
    (column) => column.kind === "drag" || column.drag_handle === true,
  );
  const reorder_enabled =
    on_reorder !== undefined &&
    !reorder_disabled &&
    sort_state === null &&
    !reorder.pending &&
    row_model_prop === undefined;
  const drag_enabled = reorder_enabled && drag_column_present;
  const box_selection_enabled =
    selection_mode === "multiple" && box_selection_enabled_prop === true;
  const active_drag_row = useMemo(() => {
    if (active_drag_row_id === null) {
      return null;
    }

    const active_row_index = row_index_by_id.get(active_drag_row_id);
    if (active_row_index === undefined) {
      return null;
    }

    const active_row = resolve_row_at_index(active_row_index);
    if (active_row === undefined) {
      return null;
    }

    return {
      row: active_row,
      row_id: active_drag_row_id,
      row_index: active_row_index,
    };
  }, [active_drag_row_id, resolve_row_at_index, row_index_by_id]);
  /** 仅定位当前模型已知的身份，异步远端定位由调用方另行处理。 */
  const resolve_known_row_index = useCallback(
    (row_id: string | null): number | null => {
      if (row_id === null) {
        return null;
      }

      const row_index = row_model.resolve_row_index(row_id);
      return row_index === undefined ? null : row_index;
    },
    [row_model],
  );

  useEffect(() => {
    const next_active_row_index = resolve_known_row_index(active_row_id);
    if (next_active_row_index !== null || active_row_id === null) {
      active_row_index_ref.current = next_active_row_index;
    }

    const next_anchor_row_index = resolve_known_row_index(anchor_row_id);
    if (next_anchor_row_index !== null || anchor_row_id === null) {
      anchor_row_index_ref.current = next_anchor_row_index;
    }
  }, [active_row_id, anchor_row_id, resolve_known_row_index]);

  useLayoutEffect(() => {
    selection_request_epoch_ref.current += 1;
  }, [row_model, row_count, selection_state]);

  /** 新选择请求使尚未返回的远端范围查询失效。 */
  const begin_selection_request = useCallback((): number => {
    selection_request_epoch_ref.current += 1;
    return selection_request_epoch_ref.current;
  }, []);

  /** 阻止迟到的选择结果覆盖后续用户操作。 */
  const is_selection_request_current = useCallback((request_epoch: number): boolean => {
    return selection_request_epoch_ref.current === request_epoch;
  }, []);

  /** 先规范化选区并同步活动位置，再向页面发布一次选择变化。 */
  const emit_selection_change = useCallback(
    (
      next_state: AppTableSelectionState,
      next_indices?: {
        active_row_index?: number | null;
        anchor_row_index?: number | null;
      },
    ): void => {
      const selection_scope_row_ids = row_model_prop === undefined ? row_ids : null;
      const normalized_next_state = normalize_app_table_selection_state(
        next_state,
        selection_scope_row_ids,
      );
      if (are_app_table_selection_states_equal(selection_state, normalized_next_state)) {
        return;
      }

      selection_request_epoch_ref.current += 1;

      if (next_indices?.active_row_index !== undefined) {
        active_row_index_ref.current = next_indices.active_row_index;
      } else {
        active_row_index_ref.current = resolve_known_row_index(normalized_next_state.active_row_id);
      }

      if (next_indices?.anchor_row_index !== undefined) {
        anchor_row_index_ref.current = next_indices.anchor_row_index;
      } else {
        anchor_row_index_ref.current = resolve_known_row_index(normalized_next_state.anchor_row_id);
      }

      on_selection_change(normalized_next_state);
    },
    [on_selection_change, resolve_known_row_index, row_ids, row_model_prop, selection_state],
  );

  useEffect(() => {
    const table_scroll_host_element = table_scroll_host_ref.current;
    if (table_scroll_host_element === null) {
      set_viewport_element(null);
      return;
    }

    const next_viewport_element = table_scroll_host_element.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    set_viewport_element(next_viewport_element);
  }, [row_count]);

  useEffect(() => {
    const table_scroll_host_element = table_scroll_host_ref.current;
    if (table_scroll_host_element === null) {
      set_viewport_height(row_height);
      return;
    }

    /** 按滚动宿主尺寸补齐短表占位高度。 */
    const update_viewport_height = (): void => {
      set_viewport_height(Math.max(table_scroll_host_element.clientHeight, row_height));
    };

    update_viewport_height();

    // 原因：短表补位依赖“可用滚动区域高度”而不是首帧 viewport 内容高度，直接观察 scroll host 更稳定
    const resize_observer = new ResizeObserver(() => {
      update_viewport_height();
    });
    resize_observer.observe(table_scroll_host_element);

    return () => {
      resize_observer.disconnect();
    };
  }, [row_count, row_height]);

  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: row_count,
    getScrollElement: () => viewport_element,
    estimateSize: () => row_height,
    overscan: virtual_overscan ?? APP_TABLE_DEFAULT_VIRTUAL_OVERSCAN,
    getItemKey: (index) => resolve_row_id_at_index(index) ?? index,
    initialRect: {
      width: 0,
      height: Math.max(viewport_height, row_height),
    },
  });

  useEffect(() => {
    virtualizer.measure();
  }, [row_count, row_height, viewport_height]);

  const virtual_rows = virtualizer.getVirtualItems();
  useEffect(() => {
    visible_range_signature_ref.current = "";
  }, [row_count, row_model.on_visible_range_change]);

  useEffect(() => {
    if (row_model.on_visible_range_change === undefined) {
      return;
    }

    const visible_range = normalize_visible_range(virtual_rows);
    if (visible_range === null) {
      return;
    }

    const range_signature = `${visible_range.start}:${visible_range.count}`;
    if (range_signature === visible_range_signature_ref.current) {
      return;
    }

    visible_range_signature_ref.current = range_signature;
    row_model.on_visible_range_change(visible_range);
  }, [row_model, virtual_rows]);
  const first_virtual_row = virtual_rows[0] ?? null;
  const last_virtual_row = virtual_rows.at(-1) ?? null;
  const spacer_heights = build_app_table_spacer_heights({
    viewport_height,
    total_size: virtualizer.getTotalSize(),
    range_start: first_virtual_row?.start ?? 0,
    range_end: last_virtual_row?.end ?? 0,
  });
  const placeholder_fill =
    placeholder_row_strategy === "fill-viewport" || placeholder_row_strategy === undefined
      ? build_app_table_placeholder_fill(spacer_heights.viewport_fill_height, row_height)
      : {
          placeholder_row_heights: [],
          residual_spacer_height: spacer_heights.viewport_fill_height,
        };
  const show_top_spacer = spacer_heights.top_spacer_height > 0.5;
  const bottom_spacer_height =
    spacer_heights.virtual_bottom_spacer_height + placeholder_fill.residual_spacer_height;
  const show_bottom_spacer = bottom_spacer_height > 0.5;

  /** 按身份维护已挂载行，供选区命中和滚动锚点测量。 */
  const register_row_element = useCallback(
    (row_id: string, row_element: HTMLTableRowElement | null): void => {
      if (row_element === null) {
        row_elements_ref.current.delete(row_id);
        return;
      }

      row_elements_ref.current.set(row_id, row_element);
    },
    [],
  );

  // 优先读取已挂载行的真实偏移，未挂载行退回固定行高估算。
  const capture_scroll_anchor_offset = useCallback(
    (row_id: string): number | null => {
      if (viewport_element === null) {
        return null;
      }

      const row_element = row_elements_ref.current.get(row_id);
      if (row_element !== undefined) {
        const row_rect = row_element.getBoundingClientRect();
        const viewport_rect = viewport_element.getBoundingClientRect();
        return row_rect.top - viewport_rect.top;
      }

      const row_index = row_model.resolve_row_index(row_id);
      if (row_index === undefined) {
        return null;
      }

      return row_index * row_height - viewport_element.scrollTop;
    },
    [row_height, row_model, viewport_element],
  );

  // 按新索引和旧偏移恢复 scrollTop，并限制在虚拟总高度内。
  const restore_scroll_anchor_offset = useCallback(
    (row_index: number, captured_offset: number): void => {
      if (viewport_element === null) {
        return;
      }

      const viewport_client_height =
        viewport_element.clientHeight > 0 ? viewport_element.clientHeight : viewport_height;
      const max_scroll_top = Math.max(0, virtualizer.getTotalSize() - viewport_client_height);
      const next_scroll_top = Math.max(
        0,
        Math.min(max_scroll_top, row_index * row_height - captured_offset),
      );
      viewport_element.scrollTop = next_scroll_top;
    },
    [row_height, viewport_element, viewport_height, virtualizer],
  );

  // 每次 layout 提交递增编号，让刷新锚点能跨提交恢复滚动。
  useLayoutEffect(() => {
    layout_commit_id_ref.current += 1;
  });

  // preserve_scroll_anchor 变化时先捕获刷新前偏移，等待数据提交后再恢复。
  useLayoutEffect(() => {
    if (
      preserve_scroll_anchor === undefined ||
      preserve_scroll_anchor.revision <= preserve_scroll_capture_revision_ref.current
    ) {
      return;
    }

    if (preserve_scroll_anchor.row_id === null) {
      preserve_scroll_capture_revision_ref.current = preserve_scroll_anchor.revision;
      pending_scroll_anchor_ref.current = null;
      preserve_scroll_request_epoch_ref.current += 1;
      return;
    }

    const captured_offset = capture_scroll_anchor_offset(preserve_scroll_anchor.row_id);
    preserve_scroll_capture_revision_ref.current = preserve_scroll_anchor.revision;
    preserve_scroll_request_epoch_ref.current += 1;
    pending_scroll_anchor_ref.current =
      captured_offset === null
        ? null
        : {
            row_id: preserve_scroll_anchor.row_id,
            offset: captured_offset,
            revision: preserve_scroll_anchor.revision,
            captured_commit: layout_commit_id_ref.current,
          };
  }, [capture_scroll_anchor_offset, preserve_scroll_anchor]);

  // 数据提交后按同步或异步 row index 恢复锚点偏移，过期请求自动失效。
  useLayoutEffect(() => {
    const pending_anchor = pending_scroll_anchor_ref.current;
    if (
      pending_anchor === null ||
      pending_anchor.captured_commit === layout_commit_id_ref.current
    ) {
      return;
    }

    const resolved_row_index = row_model.resolve_row_index(pending_anchor.row_id);
    if (resolved_row_index !== undefined) {
      restore_scroll_anchor_offset(resolved_row_index, pending_anchor.offset);
      pending_scroll_anchor_ref.current = null;
      return;
    }

    if (row_model.resolve_row_index_async === undefined) {
      pending_scroll_anchor_ref.current = null;
      return;
    }

    const request_epoch = preserve_scroll_request_epoch_ref.current + 1;
    preserve_scroll_request_epoch_ref.current = request_epoch;
    let request_active = true;

    void Promise.resolve(row_model.resolve_row_index_async(pending_anchor.row_id))
      .then((async_row_index) => {
        const latest_anchor = pending_scroll_anchor_ref.current;
        if (
          !request_active ||
          request_epoch !== preserve_scroll_request_epoch_ref.current ||
          latest_anchor === null ||
          latest_anchor.revision !== pending_anchor.revision ||
          latest_anchor.row_id !== pending_anchor.row_id
        ) {
          return;
        }

        if (async_row_index !== undefined) {
          restore_scroll_anchor_offset(async_row_index, pending_anchor.offset);
        }
        pending_scroll_anchor_ref.current = null;
      })
      .catch((error: unknown) => {
        if (
          request_active &&
          request_epoch === preserve_scroll_request_epoch_ref.current &&
          pending_scroll_anchor_ref.current?.revision === pending_anchor.revision
        ) {
          pending_scroll_anchor_ref.current = null;
          on_selection_error?.(error);
        }
      });

    return () => {
      request_active = false;
    };
  }, [on_selection_error, restore_scroll_anchor_offset, row_count, row_model, virtual_rows]);

  /** 归还表格键盘入口时保持现有滚动位置。 */
  const focus_table_scroll_host = useCallback((): void => {
    const table_scroll_host_element = table_scroll_host_ref.current;

    if (table_scroll_host_element !== null) {
      table_scroll_host_element.focus({
        preventScroll: true,
      });
    }
  }, []);

  /** 优先定位真实行，跨虚拟窗口时按完整索引滚动。 */
  const scroll_row_index_into_view = useCallback(
    (
      row_index: number | null,
      row_id?: string | null,
      alignment: AppTableScrollAlignment = "nearest",
    ): boolean => {
      if (row_index === null || row_index < 0) {
        return false;
      }

      const row_element =
        row_id === undefined || row_id === null ? undefined : row_elements_ref.current.get(row_id);
      if (row_element !== undefined) {
        row_element.scrollIntoView({
          block: alignment,
          inline: "nearest",
        });
        return true;
      }

      if (viewport_element === null) {
        return false;
      }

      // 为什么：虚拟列表里目标行可能还没挂到 DOM，上卷交给 virtualizer 才能稳定命中
      virtualizer.scrollToIndex(row_index, {
        align: alignment === "nearest" ? "auto" : "start",
      });
      return true;
    },
    [viewport_element, virtualizer],
  );

  useLayoutEffect(() => {
    const row_id = reorder_scroll_row_id_ref.current;
    if (row_id === null) return;

    // 菜单关闭与新顺序布局完成后再定位，避免焦点恢复把视口带回旧位置。
    const frame_id = requestAnimationFrame(() => {
      scroll_row_index_into_view(row_model.resolve_row_index(row_id) ?? null, row_id);
      if (!reorder.pending) reorder_scroll_row_id_ref.current = null;
    });
    return () => cancelAnimationFrame(frame_id);
  }, [reorder.pending, row_model, scroll_row_index_into_view]);

  const scroll_to_row_id = scroll_to_row?.row_id;
  const scroll_to_row_revision = scroll_to_row?.revision;

  useLayoutEffect(() => {
    // 外部定位只负责把目标行带回视口，不参与选区状态或键盘焦点写入。
    const request_epoch = scroll_to_row_request_epoch_ref.current + 1;
    scroll_to_row_request_epoch_ref.current = request_epoch;
    let request_active = true;
    /** 卸载或新定位请求使旧异步定位失效。 */
    const is_current_request = (): boolean => {
      return request_active && scroll_to_row_request_epoch_ref.current === request_epoch;
    };

    if (scroll_to_row_revision === undefined || scroll_to_row_id === undefined) {
      return () => {
        request_active = false;
        scroll_to_row_request_epoch_ref.current += 1;
      };
    }

    const consumed_target = consumed_scroll_to_row_ref.current;
    if (
      consumed_target?.row_id === scroll_to_row_id &&
      consumed_target.revision === scroll_to_row_revision
    ) {
      return () => {
        request_active = false;
        scroll_to_row_request_epoch_ref.current += 1;
      };
    }

    const resolved_row_index = row_model.resolve_row_index(scroll_to_row_id);
    if (resolved_row_index !== undefined) {
      if (
        is_current_request() &&
        scroll_row_index_into_view(resolved_row_index, scroll_to_row_id, "start")
      ) {
        consumed_scroll_to_row_ref.current = {
          row_id: scroll_to_row_id,
          revision: scroll_to_row_revision,
        };
      }
      return () => {
        request_active = false;
        scroll_to_row_request_epoch_ref.current += 1;
      };
    }

    if (row_model.resolve_row_index_async === undefined) {
      return () => {
        request_active = false;
        scroll_to_row_request_epoch_ref.current += 1;
      };
    }

    void Promise.resolve(row_model.resolve_row_index_async(scroll_to_row_id))
      .then((async_row_index) => {
        if (!is_current_request() || async_row_index === undefined) {
          return;
        }

        if (scroll_row_index_into_view(async_row_index, scroll_to_row_id, "start")) {
          consumed_scroll_to_row_ref.current = {
            row_id: scroll_to_row_id,
            revision: scroll_to_row_revision,
          };
        }
      })
      .catch((error: unknown) => {
        if (!is_current_request()) {
          return;
        }

        consumed_scroll_to_row_ref.current = {
          row_id: scroll_to_row_id,
          revision: scroll_to_row_revision,
        };
        on_selection_error?.(error);
      });

    return () => {
      request_active = false;
      scroll_to_row_request_epoch_ref.current += 1;
    };
  }, [
    on_selection_error,
    row_model,
    scroll_row_index_into_view,
    scroll_to_row_id,
    scroll_to_row_revision,
  ]);

  /** 选择范围按完整列表解析，远端窗口可补取未挂载身份。 */
  const resolve_row_ids_range = useCallback(
    async (range: { start: number; count: number }): Promise<string[]> => {
      const normalized_range = normalize_row_range(row_count, range.start, range.count);
      if (normalized_range.count <= 0) {
        return [];
      }

      if (row_model.resolve_row_ids_range !== undefined) {
        return await row_model.resolve_row_ids_range(normalized_range);
      }

      return Array.from({ length: normalized_range.count }, (_, offset) => {
        return row_model.get_row_id_at_index(normalized_range.start + offset);
      }).flatMap((row_id) => {
        return row_id === undefined ? [] : [row_id];
      });
    },
    [row_count, row_model],
  );

  /** 先读取已加载身份，缺失时复用范围解析补取一行。 */
  const resolve_single_row_id = useCallback(
    async (row_index: number): Promise<string | null> => {
      const loaded_row_id = row_model.get_row_id_at_index(row_index);
      if (loaded_row_id !== undefined) {
        return loaded_row_id;
      }

      const resolved_row_ids = await resolve_row_ids_range({
        start: row_index,
        count: 1,
      });
      return resolved_row_ids[0] ?? null;
    },
    [resolve_row_ids_range, row_model],
  );

  /** 框选预览共用同步引用，并跳过相同选区的重复渲染。 */
  const apply_selection_preview_state = useCallback(
    (next_state: AppTableSelectionState | null): void => {
      selection_preview_state_ref.current = next_state;
      set_selection_preview_state((previous_state) => {
        if (previous_state === next_state) {
          return previous_state;
        } else if (previous_state !== null && next_state !== null) {
          return are_app_table_selection_states_equal(previous_state, next_state)
            ? previous_state
            : next_state;
        } else {
          return next_state;
        }
      });
    },
    [],
  );

  /** 结束框选时释放手势起点、候选身份和原选区。 */
  const clear_selection_refs = useCallback((): void => {
    selection_box_ref.current = null;
    selection_box_ids_ref.current = [];
    selection_origin_state_ref.current = null;
  }, []);

  /** 撤销尚未执行的框选帧，避免结束后再次写入预览。 */
  const cancel_selection_animation_frame = useCallback((): void => {
    if (selection_frame_id_ref.current === null) {
      return;
    }

    window.cancelAnimationFrame(selection_frame_id_ref.current);
    selection_frame_id_ref.current = null;
  }, []);

  /** 一次测量并同步框选矩形及选中行，松手前也可主动刷新。 */
  const flush_selection_box_update = useCallback((): void => {
    cancel_selection_animation_frame();

    const current_state = selection_box_ref.current;
    if (current_state === null) {
      return;
    }

    sync_selection_box_element_style({
      host_element: table_scroll_host_ref.current,
      selection_box_element: selection_box_element_ref.current,
      selection_box: current_state,
    });

    if (!current_state.moved) {
      return;
    }

    suppress_click_ref.current = true;
    // 原因：这里只扫描当前视口中实际挂载的行节点，把框选每帧的成本压到可见规模
    const next_row_ids = [...row_elements_ref.current.entries()]
      .filter(([, row_element]) => {
        return intersects_selection_box(row_element, current_state);
      })
      .map(([row_id]) => row_id)
      .sort((left_row_id, right_row_id) => {
        return (
          (row_index_by_id.get(left_row_id) ?? Number.MAX_SAFE_INTEGER) -
          (row_index_by_id.get(right_row_id) ?? Number.MAX_SAFE_INTEGER)
        );
      });

    if (
      next_row_ids.length === selection_box_ids_ref.current.length &&
      next_row_ids.every((row_id, index) => row_id === selection_box_ids_ref.current[index])
    ) {
      return;
    }

    selection_box_ids_ref.current = next_row_ids;
    apply_selection_preview_state(
      build_app_table_box_selection_change({
        current_state: selection_origin_state_ref.current ?? selection_state,
        next_row_ids,
      }),
    );
  }, [
    apply_selection_preview_state,
    cancel_selection_animation_frame,
    row_index_by_id,
    selection_state,
  ]);

  /** 将连续指针移动合并到一帧内计算。 */
  const schedule_selection_box_update = useCallback((): void => {
    if (selection_frame_id_ref.current !== null) {
      return;
    }

    selection_frame_id_ref.current = window.requestAnimationFrame(() => {
      selection_frame_id_ref.current = null;
      flush_selection_box_update();
    });
  }, [flush_selection_box_update]);

  /** 取消未完成的帧，并将显示与临时引用一起交回页面选区。 */
  const reset_selection_interaction = useCallback(
    (options?: { commit_selection_preview?: boolean }): void => {
      cancel_selection_animation_frame();
      sync_selection_box_element_style({
        host_element: table_scroll_host_ref.current,
        selection_box_element: selection_box_element_ref.current,
        selection_box: null,
      });
      if (options?.commit_selection_preview === true) {
        const pending_selection_preview = selection_preview_state_ref.current;
        if (pending_selection_preview !== null) {
          emit_selection_change(pending_selection_preview);
        }
      }

      clear_selection_refs();
      apply_selection_preview_state(null);
      set_selection_box_active(false);
      window.setTimeout(() => {
        suppress_click_ref.current = false;
      }, 0);
    },
    [
      apply_selection_preview_state,
      cancel_selection_animation_frame,
      clear_selection_refs,
      emit_selection_change,
    ],
  );

  useEffect(() => {
    if (!box_selection_enabled) {
      return;
    }
    /** 指针超过点击容差后才进入框选，并合并到下一动画帧更新。 */
    function handle_pointer_move(event: PointerEvent): void {
      const previous_state = selection_box_ref.current;
      if (previous_state === null) {
        return;
      }

      const moved =
        previous_state.moved ||
        Math.abs(event.clientX - previous_state.origin_x) > 4 ||
        Math.abs(event.clientY - previous_state.origin_y) > 4;
      const next_state: SelectionBoxState = {
        ...previous_state,
        current_x: event.clientX,
        current_y: event.clientY,
        moved,
      };

      selection_box_ref.current = next_state;
      schedule_selection_box_update();
    }
    /** 松手前刷新最后一帧，仅提交发生实际拖动的框选预览。 */
    function handle_pointer_up(): void {
      flush_selection_box_update();
      reset_selection_interaction({
        commit_selection_preview: selection_box_ref.current?.moved === true,
      });
    }
    // 指针取消与窗口失焦都撤销框选预览。
    function cancel_selection(): void {
      reset_selection_interaction();
    }

    window.addEventListener("pointermove", handle_pointer_move);
    window.addEventListener("pointerup", handle_pointer_up);
    window.addEventListener("pointercancel", cancel_selection);
    window.addEventListener("blur", cancel_selection);

    return () => {
      window.removeEventListener("pointermove", handle_pointer_move);
      window.removeEventListener("pointerup", handle_pointer_up);
      window.removeEventListener("pointercancel", cancel_selection);
      window.removeEventListener("blur", cancel_selection);
      cancel_selection_animation_frame();
      apply_selection_preview_state(null);
      set_selection_box_active(false);
      clear_selection_refs();
    };
  }, [
    apply_selection_preview_state,
    box_selection_enabled,
    cancel_selection_animation_frame,
    clear_selection_refs,
    flush_selection_box_update,
    reset_selection_interaction,
    schedule_selection_box_update,
  ]);

  /** 阻止框选松手产生的合成点击再次改变选区。 */
  const should_ignore_click = useCallback((): boolean => {
    return suppress_click_ref.current;
  }, []);

  /** 在合法空白区域启动框选，并保留修饰键对应的原选区。 */
  const handle_box_selection_start = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!box_selection_enabled || event.button !== 0) {
        return;
      }

      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      if (should_ignore_app_table_box_selection(event.target)) {
        return;
      }

      focus_table_scroll_host();

      const next_state: SelectionBoxState = {
        origin_x: event.clientX,
        origin_y: event.clientY,
        current_x: event.clientX,
        current_y: event.clientY,
        moved: false,
      };

      selection_origin_state_ref.current = selection_state;
      selection_box_ref.current = next_state;
      selection_box_ids_ref.current = [];
      apply_selection_preview_state(null);
      set_selection_box_active(true);
      sync_selection_box_element_style({
        host_element: table_scroll_host_ref.current,
        selection_box_element: selection_box_element_ref.current,
        selection_box: next_state,
      });
    },
    [
      apply_selection_preview_state,
      box_selection_enabled,
      focus_table_scroll_host,
      selection_state,
    ],
  );

  /** 统一普通点击、切换选择和跨窗口范围选择。 */
  const handle_row_click = useCallback(
    (row_id: string, row_index: number, event: MouseEvent<HTMLTableRowElement>): void => {
      focus_table_scroll_host();

      if (selection_mode === "multiple" && event.shiftKey) {
        const anchor_row_id =
          selection_state.anchor_row_id ?? selection_state.active_row_id ?? row_id;
        const anchor_row_index =
          anchor_row_index_ref.current ?? active_row_index_ref.current ?? row_index;
        const range_start = Math.min(anchor_row_index, row_index);
        const range_count = Math.abs(row_index - anchor_row_index) + 1;
        const request_epoch = begin_selection_request();

        void resolve_row_ids_range({
          start: range_start,
          count: range_count,
        })
          .then((range_row_ids) => {
            if (!is_selection_request_current(request_epoch)) {
              return;
            }

            emit_selection_change(
              {
                selected_row_ids: range_row_ids,
                active_row_id: row_id,
                anchor_row_id,
              },
              {
                active_row_index: row_index,
                anchor_row_index,
              },
            );
          })
          .catch((error: unknown) => {
            if (!is_selection_request_current(request_epoch)) {
              return;
            }

            on_selection_error?.(error);
          });
        return;
      }

      emit_selection_change(
        build_app_table_click_selection_change({
          selection_mode,
          ordered_row_ids: row_ids,
          current_state: selection_state,
          target_row_id: row_id,
          extend: event.ctrlKey || event.metaKey,
          range: event.shiftKey,
        }),
        {
          active_row_index: row_index,
          anchor_row_index: selection_mode === "none" ? anchor_row_index_ref.current : row_index,
        },
      );
    },
    [
      begin_selection_request,
      emit_selection_change,
      focus_table_scroll_host,
      is_selection_request_current,
      on_selection_error,
      resolve_row_ids_range,
      row_ids,
      selection_mode,
      selection_state,
    ],
  );

  /** 右键已选行保持整组，右键未选行仅定位该行。 */
  const handle_row_context = useCallback(
    (row_id: string): void => {
      focus_table_scroll_host();
      emit_selection_change(
        build_app_table_context_selection_change({
          selection_mode,
          current_state: selection_state,
          target_row_id: row_id,
        }),
      );
    },
    [emit_selection_change, focus_table_scroll_host, selection_mode, selection_state],
  );

  /** 在表格焦点下处理选择、导航和激活，拖动时交给排序键盘入口。 */
  const handle_table_keydown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const primary_modifier_pressed = has_primary_keyboard_modifier(event);
      const pressed_key = event.key.toLowerCase();

      if (!should_handle_table_keydown(event) || active_drag_row_id !== null) {
        return;
      }

      if (
        selection_mode === "multiple" &&
        primary_modifier_pressed &&
        !event.altKey &&
        !event.shiftKey &&
        pressed_key === "a"
      ) {
        event.preventDefault();
        const request_epoch = begin_selection_request();
        void resolve_row_ids_range({
          start: 0,
          count: row_count,
        })
          .then((next_row_ids) => {
            if (!is_selection_request_current(request_epoch)) {
              return;
            }

            const fallback_anchor_row_id = next_row_ids[0] ?? null;
            const fallback_active_row_id = selection_state.active_row_id ?? fallback_anchor_row_id;
            const fallback_anchor_index = next_row_ids.length > 0 ? 0 : null;

            emit_selection_change(
              build_app_table_select_all_selection_change({
                ordered_row_ids: next_row_ids,
                current_state: selection_state,
              }),
              {
                active_row_index: active_row_index_ref.current ?? fallback_anchor_index,
                anchor_row_index: anchor_row_index_ref.current ?? fallback_anchor_index,
              },
            );

            if (fallback_active_row_id === null) {
              active_row_index_ref.current = null;
            }
          })
          .catch((error: unknown) => {
            if (!is_selection_request_current(request_epoch)) {
              return;
            }

            on_selection_error?.(error);
          });
        return;
      }

      if (event.altKey || primary_modifier_pressed) {
        return;
      }

      if (event.key === "Enter") {
        if (
          !event.shiftKey &&
          !event.repeat &&
          selection_state.active_row_id !== null &&
          on_row_activate
        ) {
          event.preventDefault();
          // 只传行身份，远端窗口中的正文读取仍由消费页面负责。
          on_row_activate(selection_state.active_row_id);
        }
        return;
      }

      let next_action: AppTableKeyboardNavigationAction | null = null;

      if (event.key === "ArrowUp") {
        next_action = "previous";
      } else if (event.key === "ArrowDown") {
        next_action = "next";
      } else if (event.key === "Home") {
        next_action = "first";
      } else if (event.key === "End") {
        next_action = "last";
      }

      if (next_action !== null) {
        event.preventDefault();
        const target_row_index = resolve_keyboard_target_index({
          row_count,
          current_index: active_row_index_ref.current,
          action: next_action,
        });
        if (target_row_index < 0) {
          return;
        }

        if (event.shiftKey && selection_mode === "multiple") {
          const anchor_row_index =
            anchor_row_index_ref.current ?? active_row_index_ref.current ?? target_row_index;
          const anchor_row_id =
            selection_state.anchor_row_id ?? selection_state.active_row_id ?? null;
          const range_start = Math.min(anchor_row_index, target_row_index);
          const range_count = Math.abs(target_row_index - anchor_row_index) + 1;
          const request_epoch = begin_selection_request();

          void resolve_row_ids_range({
            start: range_start,
            count: range_count,
          })
            .then((range_row_ids) => {
              if (!is_selection_request_current(request_epoch)) {
                return;
              }

              const target_row_id =
                target_row_index <= anchor_row_index
                  ? (range_row_ids[0] ?? null)
                  : (range_row_ids.at(-1) ?? null);
              if (target_row_id === null) {
                return;
              }

              scroll_row_index_into_view(target_row_index, target_row_id);
              emit_selection_change(
                {
                  selected_row_ids: range_row_ids,
                  active_row_id: target_row_id,
                  anchor_row_id: anchor_row_id ?? target_row_id,
                },
                {
                  active_row_index: target_row_index,
                  anchor_row_index,
                },
              );
            })
            .catch((error: unknown) => {
              if (!is_selection_request_current(request_epoch)) {
                return;
              }

              on_selection_error?.(error);
            });
          return;
        }

        const request_epoch = begin_selection_request();
        void resolve_single_row_id(target_row_index)
          .then((target_row_id) => {
            if (!is_selection_request_current(request_epoch)) {
              return;
            }

            if (target_row_id === null) {
              return;
            }

            let next_selection_state: AppTableSelectionState;
            if (selection_mode === "none") {
              next_selection_state = {
                selected_row_ids: [],
                active_row_id: target_row_id,
                anchor_row_id: null,
              };
            } else {
              next_selection_state = {
                selected_row_ids: [target_row_id],
                active_row_id: target_row_id,
                anchor_row_id: target_row_id,
              };
            }

            scroll_row_index_into_view(target_row_index, target_row_id); // 为什么：键盘切换项目时要让虚拟表格主动把目标行滚进视口，否则选择状态会“跳”到屏幕外
            emit_selection_change(next_selection_state, {
              active_row_index: target_row_index,
              anchor_row_index: selection_mode === "none" ? null : target_row_index,
            });
          })
          .catch((error: unknown) => {
            if (!is_selection_request_current(request_epoch)) {
              return;
            }

            on_selection_error?.(error);
          });
      }
    },
    [
      active_drag_row_id,
      begin_selection_request,
      emit_selection_change,
      is_selection_request_current,
      on_row_activate,
      on_selection_error,
      resolve_row_ids_range,
      resolve_single_row_id,
      row_count,
      scroll_row_index_into_view,
      selection_mode,
      selection_state,
    ],
  );

  /** 起拖时按表格整体宽度固定浮层，跨虚拟窗口仍保持列对齐。 */
  const sync_drag_overlay_width = useCallback((): void => {
    const table_body_element = table_body_ref.current;
    if (table_body_element === null) {
      set_drag_overlay_width(null);
      return;
    }

    const table_container_element = table_body_element.closest('[data-slot="table-container"]');
    if (table_container_element instanceof HTMLElement) {
      set_drag_overlay_width(table_container_element.getBoundingClientRect().width);
      return;
    }

    set_drag_overlay_width(null);
  }, []);

  /** 页面提供行级限制，未限制的行使用表格统一重排能力。 */
  const resolve_row_can_drag = useCallback(
    (row: Row, row_index: number): boolean => {
      return get_row_can_drag?.(row, row_index) ?? true;
    },
    [get_row_can_drag],
  );
  /** 菜单和拖拽共享顺序预览与提交锁，菜单额外按身份跟随滚动目标。 */
  function submit_reorder(ordered_row_ids: string[], reveal_row_id: string | null = null): void {
    if (reorder.submit(ordered_row_ids)) reorder_scroll_row_id_ref.current = reveal_row_id;
  }

  // 只在菜单打开时计算完整目标顺序，页面业务项与通用操作使用同一选区裁决。
  const render_row_context_menu =
    render_row_context_menu_items === undefined && on_reorder === undefined
      ? undefined
      : (payload: AppTableRowEvent<Row>): ReactNode => {
          const target_row_ids = resolve_app_table_target_row_ids(
            payload.row_id,
            selection_state.selected_row_ids,
            selection_mode,
          );
          const business_items = render_row_context_menu_items?.({ ...payload, target_row_ids });
          return (
            <AppContextMenuContent finalFocus={table_scroll_host_ref}>
              {business_items}
              {on_reorder !== undefined ? (
                <>
                  {business_items != null ? <AppContextMenuSeparator /> : null}
                  <AppContextMenuGroup>
                    {(["top", "bottom"] as const).map((target) => {
                      const ordered_row_ids = reorder_enabled
                        ? move_ordered_ids({
                            ordered_ids: row_ids,
                            moving_ids: target_row_ids,
                            target,
                          })
                        : row_ids;
                      return (
                        <AppContextMenuItem
                          key={target}
                          disabled={
                            !reorder_enabled ||
                            ordered_row_ids.every((row_id, index) => row_id === row_ids[index])
                          }
                          onClick={() => submit_reorder(ordered_row_ids, payload.row_id)}
                        >
                          {target === "top" ? <ArrowUpToLine /> : <ArrowDownToLine />}
                          {t(
                            target === "top"
                              ? "app.action.move_to_top"
                              : "app.action.move_to_bottom",
                          )}
                        </AppContextMenuItem>
                      );
                    })}
                  </AppContextMenuGroup>
                </>
              ) : null}
            </AppContextMenuContent>
          );
        };

  /** 表头、正文与浮层共用列宽声明。 */
  const render_colgroup = (): JSX.Element => {
    return (
      <colgroup>
        {columns.map((column) => (
          <col
            key={column.id}
            style={
              column.width === undefined ? undefined : { width: `${column.width.toString()}px` }
            }
          />
        ))}
      </colgroup>
    );
  };

  const header = (
    <div className="app-table__head-wrap">
      <Table className={cn("app-table__table", table_class_name)}>
        {render_colgroup()}
        <TableHeader className="app-table__head">
          <TableRow>
            {columns.map((column, column_index) => {
              const direction = sort_state?.column_id === column.id ? sort_state.direction : null;
              const on_cycle_sort =
                column.kind === "data" && column.sortable !== undefined && !column.sortable.disabled
                  ? (): void => {
                      if (sort_state?.column_id !== column.id) {
                        on_sort_change({
                          column_id: column.id,
                          direction: "ascending",
                        });
                        return;
                      }

                      if (sort_state.direction === "ascending") {
                        on_sort_change({
                          column_id: column.id,
                          direction: "descending",
                        });
                        return;
                      }

                      on_sort_change(null);
                    }
                  : null;

              return (
                <Fragment key={`${column.id}-${column_index.toString()}`}>
                  <AppTableHeadCell
                    column={column}
                    direction={direction}
                    on_cycle_sort={on_cycle_sort}
                    has_divider={column_index < columns.length - 1}
                  />
                </Fragment>
              );
            })}
          </TableRow>
        </TableHeader>
      </Table>
    </div>
  );

  const overlay =
    active_drag_row === null ? null : (
      <div
        className="app-table__drag-overlay"
        style={drag_overlay_width === null ? undefined : { width: drag_overlay_width }}
      >
        <Table className={cn("app-table__table app-table__table--overlay", table_class_name)}>
          {render_colgroup()}
          <TableBody>
            <TableRow
              data-row-index={active_drag_row.row_index}
              data-zebra={resolve_app_table_row_zebra(active_drag_row.row_index)}
              data-state={selected_row_id_set.has(active_drag_row.row_id) ? "selected" : undefined}
              data-dragging="true"
              className={cn("app-table__row", row_class_name?.(active_drag_row))}
            >
              <AppTableRowCells
                columns={columns}
                payload={{
                  ...active_drag_row,
                  presentation: "overlay",
                }}
                dragging
                row_number={resolve_row_number(active_drag_row.row_id, active_drag_row.row_index)}
                drag_disabled
              />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  const root_style = {
    "--app-table-row-height": `${row_height.toString()}px`,
  } as CSSProperties;

  return (
    <div className={cn("app-table", className)} style={root_style}>
      {header}
      <div
        ref={table_scroll_host_ref}
        className="app-table__scroll-host"
        tabIndex={0}
        onKeyDown={handle_table_keydown}
        onPointerDownCapture={handle_box_selection_start}
      >
        <ScrollArea className="app-table__scroll">
          <DragDropProvider
            {...SORTABLE_PROVIDER_OPTIONS}
            {...reorder.events}
            onDragStart={(event, manager) => {
              reorder.events.onDragStart(event, manager);
              sync_drag_overlay_width();
            }}
          >
            <Table className={cn("app-table__table app-table__table--body", table_class_name)}>
              {render_colgroup()}
              <TableBody ref={table_body_ref}>
                {show_top_spacer ? (
                  <AppTableSpacerRow
                    column_count={columns.length}
                    height={spacer_heights.top_spacer_height}
                  />
                ) : null}
                {virtual_rows.map((virtual_row) => {
                  const row = resolve_row_at_index(virtual_row.index);
                  const row_id = resolve_row_id_at_index(virtual_row.index);
                  if (row === undefined || row_id === undefined) {
                    return null;
                  }

                  const row_event: AppTableRowEvent<Row> = {
                    row,
                    row_id,
                    row_index: virtual_row.index,
                  };

                  return (
                    <AppTableSortableRow
                      key={row_id}
                      row={row}
                      row_id={row_id}
                      row_index={virtual_row.index}
                      row_number={resolve_row_number(row_id, virtual_row.index)}
                      overlay_source={active_drag_row?.row_id === row_id}
                      columns={columns}
                      selected={selected_row_id_set.has(row_id)}
                      active={rendered_selection_state.active_row_id === row_id}
                      drag_enabled={drag_enabled}
                      can_drag={resolve_row_can_drag(row, virtual_row.index)}
                      row_class_name={row_class_name?.(row_event)}
                      render_row_context_menu={render_row_context_menu}
                      should_ignore_click={should_ignore_click}
                      on_row_click={handle_row_click}
                      on_row_context={handle_row_context}
                      on_row_activate={on_row_activate}
                      register_row_element={register_row_element}
                    />
                  );
                })}
                {placeholder_fill.placeholder_row_heights.map(
                  (placeholder_height, placeholder_index) => (
                    <AppTablePlaceholderRow
                      key={`app-table-placeholder-${placeholder_index.toString()}`}
                      columns={columns}
                      row_index={row_count + placeholder_index}
                      height={placeholder_height}
                    />
                  ),
                )}
                {show_bottom_spacer ? (
                  <AppTableSpacerRow column_count={columns.length} height={bottom_spacer_height} />
                ) : null}
              </TableBody>
            </Table>
            {/* 本地顺序已在松手时接管展示，无需叠加回落动画。 */}
            <DragOverlay dropAnimation={null}>{overlay}</DragOverlay>
          </DragDropProvider>
        </ScrollArea>
        {selection_box_active ? (
          <div ref={selection_box_element_ref} className="app-table__selection-box" />
        ) : null}
      </div>
    </div>
  );
}

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { AppContextMenu, AppContextMenuTrigger } from "@/widgets/app-context-menu/app-context-menu";
import { ScrollArea } from "@/shadcn/scroll-area";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/shadcn/table";
import "@/widgets/app-table/app-table.css";
import {
  build_app_table_reordered_row_ids,
  resolve_app_table_drag_group_row_ids,
} from "@/widgets/app-table/app-table-dnd";
import {
  AppTableHeadCell,
  AppTablePlaceholderRow,
  AppTableSpacerRow,
} from "@/widgets/app-table/app-table-render";
import {
  are_app_table_selection_states_equal,
  build_app_table_box_selection_change,
  build_app_table_click_selection_change,
  build_app_table_context_selection_change,
  build_app_table_keyboard_selection_change,
  build_app_table_select_all_selection_change,
  normalize_app_table_selection_state,
} from "@/widgets/app-table/app-table-selection";
import type {
  AppTableCellPayload,
  AppTableColumn,
  AppTableDragCellPayload,
  AppTableProps,
  AppTableRowEvent,
  AppTableSelectionState,
} from "@/widgets/app-table/app-table-types";
import {
  APP_TABLE_DEFAULT_ESTIMATED_ROW_HEIGHT,
  APP_TABLE_DEFAULT_VIRTUAL_OVERSCAN,
  build_app_table_placeholder_fill,
  build_app_table_spacer_heights,
  resolve_app_table_row_zebra,
} from "@/widgets/app-table/app-table-virtualization";

type SelectionBoxState = {
  origin_x: number;
  origin_y: number;
  current_x: number;
  current_y: number;
  moved: boolean;
};

type AppTableSortableRowProps<Row> = {
  row: Row;
  row_id: string;
  row_index: number;
  columns: AppTableColumn<Row>[];
  selected: boolean;
  active: boolean;
  drag_enabled: boolean;
  can_drag: boolean;
  row_class_name?: string;
  render_row_context_menu?: (payload: AppTableRowEvent<Row>) => ReactNode;
  ignore_row_click_target?: (target_element: HTMLElement) => boolean;
  should_ignore_click: () => boolean;
  on_measure_row: (row_element: HTMLTableRowElement) => void;
  on_row_click: (row_id: string, event: MouseEvent<HTMLTableRowElement>) => void;
  on_row_context: (row_id: string) => void;
  on_row_double_click?: (payload: AppTableRowEvent<Row>) => void;
  register_row_element: (row_id: string, row_element: HTMLTableRowElement | null) => void;
};

function build_selection_box_rect(selection_box: SelectionBoxState): DOMRect {
  return new DOMRect(
    Math.min(selection_box.origin_x, selection_box.current_x),
    Math.min(selection_box.origin_y, selection_box.current_y),
    Math.abs(selection_box.current_x - selection_box.origin_x),
    Math.abs(selection_box.current_y - selection_box.origin_y),
  );
}

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

function has_primary_keyboard_modifier(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): boolean {
  return event.ctrlKey || event.metaKey;
}

function should_handle_table_keydown(event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  if (event.nativeEvent.isComposing) {
    return false;
  } else {
    return event.target === event.currentTarget;
  }
}

function AppTableSortableRow<Row>(props: AppTableSortableRowProps<Row>): JSX.Element {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: props.row_id,
    disabled: !props.drag_enabled || !props.can_drag,
  });

  const row_style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const row_event: AppTableRowEvent<Row> = {
    row: props.row,
    row_id: props.row_id,
    row_index: props.row_index,
  };

  const set_row_element = (row_element: HTMLTableRowElement | null): void => {
    setNodeRef(row_element);
    props.register_row_element(props.row_id, row_element);
    if (row_element !== null) {
      props.on_measure_row(row_element);
    }
  };

  const row_body = (
    <TableRow
      ref={set_row_element}
      data-index={props.row_index}
      data-active={props.active ? "true" : undefined}
      data-row-index={props.row_index}
      data-zebra={resolve_app_table_row_zebra(props.row_index)}
      data-state={props.selected ? "selected" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      className={cn("app-table__row", props.row_class_name)}
      style={row_style}
      onClick={(event) => {
        if (props.should_ignore_click()) {
          event.preventDefault();
          return;
        }

        if (event.target instanceof HTMLElement && props.ignore_row_click_target?.(event.target)) {
          return;
        }

        props.on_row_click(props.row_id, event);
      }}
      onContextMenu={(event) => {
        if (event.target instanceof HTMLElement && props.ignore_row_click_target?.(event.target)) {
          return;
        }

        props.on_row_context(props.row_id);
      }}
      onDoubleClick={(event) => {
        if (props.should_ignore_click()) {
          return;
        }

        if (event.target instanceof HTMLElement && props.ignore_row_click_target?.(event.target)) {
          return;
        }

        props.on_row_double_click?.(row_event);
      }}
    >
      {props.columns.map((column, column_index) => {
        const cell_payload: AppTableCellPayload<Row> = {
          ...row_event,
          active: props.active,
          selected: props.selected,
          dragging: isDragging,
          can_drag: props.can_drag,
          presentation: "body",
        };
        const drag_payload: AppTableDragCellPayload<Row> = {
          ...cell_payload,
          drag_handle:
            column.kind === "drag"
              ? {
                  attributes,
                  listeners,
                  disabled: !props.drag_enabled || !props.can_drag,
                }
              : null,
        };

        return (
          <TableCell
            key={`${props.row_id}-${column.id}`}
            className={cn(
              "app-table__body-cell",
              column.kind === "drag" ? "app-table__drag-cell" : undefined,
              column.cell_class_name,
            )}
            data-align={column.align ?? (column.kind === "drag" ? "center" : "left")}
            data-divider={column_index < props.columns.length - 1 ? "true" : undefined}
          >
            {column.kind === "drag"
              ? column.render_cell(drag_payload)
              : column.render_cell(cell_payload)}
          </TableCell>
        );
      })}
    </TableRow>
  );

  if (props.render_row_context_menu === undefined) {
    return row_body;
  }

  return (
    <AppContextMenu
      onOpenChange={(next_open) => {
        if (next_open) {
          props.on_row_context(props.row_id);
        }
      }}
    >
      <AppContextMenuTrigger asChild>{row_body}</AppContextMenuTrigger>
      {props.render_row_context_menu(row_event)}
    </AppContextMenu>
  );
}

export function AppTable<Row>(props: AppTableProps<Row>): JSX.Element {
  const {
    rows,
    columns,
    selection_mode,
    selected_row_ids,
    active_row_id,
    anchor_row_id,
    sort_state,
    drag_enabled: drag_enabled_prop,
    get_row_id,
    get_row_can_drag,
    on_selection_change,
    on_sort_change,
    on_reorder,
    on_row_double_click,
    render_row_context_menu,
    ignore_row_click_target,
    ignore_box_select_target,
    box_selection_enabled: box_selection_enabled_prop,
    virtual_overscan,
    estimated_row_height,
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
  const suppress_click_ref = useRef(false);
  const [viewport_element, set_viewport_element] = useState<HTMLElement | null>(null);
  const [viewport_height, set_viewport_height] = useState(
    estimated_row_height ?? APP_TABLE_DEFAULT_ESTIMATED_ROW_HEIGHT,
  );
  const [measured_row_height, set_measured_row_height] = useState(
    estimated_row_height ?? APP_TABLE_DEFAULT_ESTIMATED_ROW_HEIGHT,
  );
  const [active_drag_row_id, set_active_drag_row_id] = useState<string | null>(null);
  const [drag_overlay_width, set_drag_overlay_width] = useState<number | null>(null);
  const [selection_box_active, set_selection_box_active] = useState(false);
  const [selection_preview_state, set_selection_preview_state] =
    useState<AppTableSelectionState | null>(null);

  const row_ids = useMemo(() => {
    return rows.map((row, index) => get_row_id(row, index));
  }, [get_row_id, rows]);
  const row_index_by_id = useMemo(() => {
    return new Map(row_ids.map((row_id, index) => [row_id, index]));
  }, [row_ids]);
  const selection_state = useMemo(() => {
    return normalize_app_table_selection_state(
      {
        selected_row_ids,
        active_row_id,
        anchor_row_id,
      },
      row_ids,
    );
  }, [active_row_id, anchor_row_id, row_ids, selected_row_ids]);
  const rendered_selection_state = selection_preview_state ?? selection_state;
  const selected_row_id_set = useMemo(() => {
    return new Set(rendered_selection_state.selected_row_ids);
  }, [rendered_selection_state.selected_row_ids]);
  const drag_column_present = columns.some((column) => column.kind === "drag");
  const drag_enabled = drag_enabled_prop && drag_column_present;
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

    const active_row = rows[active_row_index];
    if (active_row === undefined) {
      return null;
    }

    return {
      row: active_row,
      row_id: active_drag_row_id,
      row_index: active_row_index,
    };
  }, [active_drag_row_id, row_index_by_id, rows]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const emit_selection_change = useCallback(
    (next_state: AppTableSelectionState): void => {
      const normalized_next_state = normalize_app_table_selection_state(next_state, row_ids);
      if (are_app_table_selection_states_equal(selection_state, normalized_next_state)) {
        return;
      }

      on_selection_change(normalized_next_state);
    },
    [on_selection_change, row_ids, selection_state],
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
  }, [rows.length]);

  useEffect(() => {
    const table_scroll_host_element = table_scroll_host_ref.current;
    if (table_scroll_host_element === null) {
      set_viewport_height(estimated_row_height ?? APP_TABLE_DEFAULT_ESTIMATED_ROW_HEIGHT);
      return;
    }

    const update_viewport_height = (): void => {
      set_viewport_height(
        Math.max(
          table_scroll_host_element.clientHeight,
          estimated_row_height ?? APP_TABLE_DEFAULT_ESTIMATED_ROW_HEIGHT,
        ),
      );
    };

    update_viewport_height();

    // Why: 短表补位依赖“可用滚动区域高度”而不是首帧 viewport 内容高度，直接观察 scroll host 更稳定。
    const resize_observer = new ResizeObserver(() => {
      update_viewport_height();
    });
    resize_observer.observe(table_scroll_host_element);

    return () => {
      resize_observer.disconnect();
    };
  }, [estimated_row_height, rows.length]);

  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => viewport_element,
    estimateSize: () => estimated_row_height ?? APP_TABLE_DEFAULT_ESTIMATED_ROW_HEIGHT,
    overscan: virtual_overscan ?? APP_TABLE_DEFAULT_VIRTUAL_OVERSCAN,
    getItemKey: (index) => row_ids[index] ?? index,
    initialRect: {
      width: 0,
      height: Math.max(
        viewport_height,
        estimated_row_height ?? APP_TABLE_DEFAULT_ESTIMATED_ROW_HEIGHT,
      ),
    },
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rows.length, viewport_height, virtualizer]);

  const virtual_rows = virtualizer.getVirtualItems();
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
      ? build_app_table_placeholder_fill(spacer_heights.viewport_fill_height, measured_row_height)
      : {
          placeholder_row_heights: [],
          residual_spacer_height: spacer_heights.viewport_fill_height,
        };
  const show_top_spacer = spacer_heights.top_spacer_height > 0.5;
  const bottom_spacer_height =
    spacer_heights.virtual_bottom_spacer_height + placeholder_fill.residual_spacer_height;
  const show_bottom_spacer = bottom_spacer_height > 0.5;
  const measure_virtual_row = useCallback(
    (row_element: HTMLTableRowElement): void => {
      virtualizer.measureElement(row_element);

      const next_row_height = Math.round(row_element.getBoundingClientRect().height);
      if (next_row_height > 0) {
        set_measured_row_height((previous_row_height) => {
          return next_row_height === previous_row_height ? previous_row_height : next_row_height;
        });
      }
    },
    [virtualizer],
  );

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

  const focus_table_scroll_host = useCallback((): void => {
    const table_scroll_host_element = table_scroll_host_ref.current;

    if (table_scroll_host_element !== null) {
      table_scroll_host_element.focus({
        preventScroll: true,
      });
    }
  }, []);

  const scroll_row_into_view = useCallback(
    (row_id: string | null): void => {
      if (row_id === null) {
        return;
      }

      const row_index = row_index_by_id.get(row_id);
      if (row_index === undefined) {
        return;
      }

      const row_element = row_elements_ref.current.get(row_id);
      if (row_element instanceof HTMLTableRowElement) {
        row_element.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
      } else {
        // 为什么：虚拟列表里目标行可能还没挂到 DOM，上卷交给 virtualizer 才能稳定命中。
        virtualizer.scrollToIndex(row_index, {
          align: "auto",
        });
      }
    },
    [row_index_by_id, virtualizer],
  );

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

  const clear_selection_refs = useCallback((): void => {
    selection_box_ref.current = null;
    selection_box_ids_ref.current = [];
    selection_origin_state_ref.current = null;
  }, []);

  const cancel_selection_animation_frame = useCallback((): void => {
    if (selection_frame_id_ref.current === null) {
      return;
    }

    window.cancelAnimationFrame(selection_frame_id_ref.current);
    selection_frame_id_ref.current = null;
  }, []);

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
    // Why: 这里只扫描当前视口中实际挂载的行节点，把框选每帧的成本压到可见规模。
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

  const schedule_selection_box_update = useCallback((): void => {
    if (selection_frame_id_ref.current !== null) {
      return;
    }

    selection_frame_id_ref.current = window.requestAnimationFrame(() => {
      selection_frame_id_ref.current = null;
      flush_selection_box_update();
    });
  }, [flush_selection_box_update]);

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

    function handle_pointer_up(): void {
      flush_selection_box_update();
      reset_selection_interaction({
        commit_selection_preview: selection_box_ref.current?.moved === true,
      });
    }

    function handle_pointer_cancel(): void {
      reset_selection_interaction();
    }

    function handle_window_blur(): void {
      reset_selection_interaction();
    }

    window.addEventListener("pointermove", handle_pointer_move);
    window.addEventListener("pointerup", handle_pointer_up);
    window.addEventListener("pointercancel", handle_pointer_cancel);
    window.addEventListener("blur", handle_window_blur);

    return () => {
      window.removeEventListener("pointermove", handle_pointer_move);
      window.removeEventListener("pointerup", handle_pointer_up);
      window.removeEventListener("pointercancel", handle_pointer_cancel);
      window.removeEventListener("blur", handle_window_blur);
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

  const should_ignore_click = useCallback((): boolean => {
    return suppress_click_ref.current;
  }, []);

  const handle_box_selection_start = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!box_selection_enabled || event.button !== 0) {
        return;
      }

      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      if (ignore_box_select_target?.(event.target)) {
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
      ignore_box_select_target,
      selection_state,
    ],
  );

  const handle_row_click = useCallback(
    (row_id: string, event: MouseEvent<HTMLTableRowElement>): void => {
      focus_table_scroll_host();
      emit_selection_change(
        build_app_table_click_selection_change({
          selection_mode,
          ordered_row_ids: row_ids,
          current_state: selection_state,
          target_row_id: row_id,
          extend: event.ctrlKey || event.metaKey,
          range: event.shiftKey,
        }),
      );
    },
    [emit_selection_change, focus_table_scroll_host, row_ids, selection_mode, selection_state],
  );

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
        emit_selection_change(
          build_app_table_select_all_selection_change({
            ordered_row_ids: row_ids,
            current_state: selection_state,
          }),
        );
        return;
      }

      if (event.altKey || primary_modifier_pressed) {
        return;
      }

      let next_selection_state: AppTableSelectionState | null = null;

      if (event.key === "ArrowUp") {
        next_selection_state = build_app_table_keyboard_selection_change({
          selection_mode,
          ordered_row_ids: row_ids,
          current_state: selection_state,
          action: "previous",
          extend: event.shiftKey,
        });
      } else if (event.key === "ArrowDown") {
        next_selection_state = build_app_table_keyboard_selection_change({
          selection_mode,
          ordered_row_ids: row_ids,
          current_state: selection_state,
          action: "next",
          extend: event.shiftKey,
        });
      } else if (event.key === "Home") {
        next_selection_state = build_app_table_keyboard_selection_change({
          selection_mode,
          ordered_row_ids: row_ids,
          current_state: selection_state,
          action: "first",
          extend: event.shiftKey,
        });
      } else if (event.key === "End") {
        next_selection_state = build_app_table_keyboard_selection_change({
          selection_mode,
          ordered_row_ids: row_ids,
          current_state: selection_state,
          action: "last",
          extend: event.shiftKey,
        });
      }

      if (next_selection_state !== null) {
        event.preventDefault();
        // 为什么：键盘切换项目时要让虚拟表格主动把目标行滚进视口，否则选择状态会“跳”到屏幕外。
        scroll_row_into_view(next_selection_state.active_row_id);
        emit_selection_change(next_selection_state);
      }
    },
    [
      active_drag_row_id,
      emit_selection_change,
      row_ids,
      scroll_row_into_view,
      selection_mode,
      selection_state,
    ],
  );

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

  const reset_drag_state = useCallback((): void => {
    set_active_drag_row_id(null);
    set_drag_overlay_width(null);
  }, []);

  const resolve_row_can_drag = useCallback(
    (row: Row, row_index: number): boolean => {
      return get_row_can_drag?.(row, row_index) ?? true;
    },
    [get_row_can_drag],
  );

  function handle_drag_start(event: DragStartEvent): void {
    if (!drag_enabled) {
      return;
    }

    const next_active_row_id = String(event.active.id);
    const active_row_index = row_index_by_id.get(next_active_row_id);
    const active_row = active_row_index === undefined ? null : (rows[active_row_index] ?? null);

    if (
      active_row_index === undefined ||
      active_row === null ||
      !resolve_row_can_drag(active_row, active_row_index)
    ) {
      reset_drag_state();
      return;
    }

    set_active_drag_row_id(next_active_row_id);
    sync_drag_overlay_width();
  }

  function handle_drag_cancel(): void {
    reset_drag_state();
  }

  function handle_drag_end(event: DragEndEvent): void {
    const over_row_id = event.over === null ? null : String(event.over.id);
    const current_active_drag_row_id = active_drag_row_id;
    reset_drag_state();

    if (!drag_enabled || current_active_drag_row_id === null || over_row_id === null) {
      return;
    }

    if (current_active_drag_row_id === over_row_id) {
      return;
    }

    const active_row_ids = resolve_app_table_drag_group_row_ids({
      selection_mode,
      active_row_id: current_active_drag_row_id,
      selected_row_ids: selection_state.selected_row_ids,
    });
    const ordered_row_ids = build_app_table_reordered_row_ids({
      ordered_row_ids: row_ids,
      moving_row_ids: active_row_ids,
      over_row_id,
    });

    void Promise.resolve(
      on_reorder({
        active_row_id: current_active_drag_row_id,
        over_row_id,
        active_row_ids,
        ordered_row_ids,
        rows,
      }),
    );
  }

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
              {columns.map((column, column_index) => {
                const overlay_payload: AppTableCellPayload<Row> = {
                  ...active_drag_row,
                  active: rendered_selection_state.active_row_id === active_drag_row.row_id,
                  selected: selected_row_id_set.has(active_drag_row.row_id),
                  dragging: true,
                  can_drag: resolve_row_can_drag(active_drag_row.row, active_drag_row.row_index),
                  presentation: "overlay",
                };
                const overlay_drag_payload: AppTableDragCellPayload<Row> = {
                  ...overlay_payload,
                  drag_handle: null,
                };

                return (
                  <TableCell
                    key={`${active_drag_row.row_id}-overlay-${column.id}`}
                    className={cn(
                      "app-table__body-cell",
                      column.kind === "drag" ? "app-table__drag-cell" : undefined,
                      column.cell_class_name,
                    )}
                    data-align={column.align ?? (column.kind === "drag" ? "center" : "left")}
                    data-divider={column_index < columns.length - 1 ? "true" : undefined}
                  >
                    {column.kind === "drag"
                      ? column.render_cell(overlay_drag_payload)
                      : column.render_cell(overlay_payload)}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );

  return (
    <div className={cn("app-table", className)}>
      {header}
      <div
        ref={table_scroll_host_ref}
        className="app-table__scroll-host"
        tabIndex={0}
        onKeyDown={handle_table_keydown}
        onPointerDownCapture={handle_box_selection_start}
      >
        <ScrollArea className="app-table__scroll">
          <DndContext
            collisionDetection={closestCenter}
            sensors={drag_enabled ? sensors : []}
            onDragStart={handle_drag_start}
            onDragCancel={handle_drag_cancel}
            onDragEnd={handle_drag_end}
          >
            <Table className={cn("app-table__table app-table__table--body", table_class_name)}>
              {render_colgroup()}
              <TableBody ref={table_body_ref}>
                <SortableContext items={row_ids} strategy={verticalListSortingStrategy}>
                  {show_top_spacer ? (
                    <AppTableSpacerRow
                      column_count={columns.length}
                      height={spacer_heights.top_spacer_height}
                    />
                  ) : null}
                  {virtual_rows.map((virtual_row) => {
                    const row = rows[virtual_row.index];
                    const row_id = row_ids[virtual_row.index];
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
                        columns={columns}
                        selected={selected_row_id_set.has(row_id)}
                        active={rendered_selection_state.active_row_id === row_id}
                        drag_enabled={drag_enabled}
                        can_drag={resolve_row_can_drag(row, virtual_row.index)}
                        row_class_name={row_class_name?.(row_event)}
                        render_row_context_menu={render_row_context_menu}
                        ignore_row_click_target={ignore_row_click_target}
                        should_ignore_click={should_ignore_click}
                        on_measure_row={measure_virtual_row}
                        on_row_click={handle_row_click}
                        on_row_context={handle_row_context}
                        on_row_double_click={on_row_double_click}
                        register_row_element={register_row_element}
                      />
                    );
                  })}
                  {placeholder_fill.placeholder_row_heights.map(
                    (placeholder_height, placeholder_index) => (
                      <AppTablePlaceholderRow
                        key={`app-table-placeholder-${placeholder_index.toString()}`}
                        columns={columns}
                        row_index={rows.length + placeholder_index}
                        height={placeholder_height}
                      />
                    ),
                  )}
                  {show_bottom_spacer ? (
                    <AppTableSpacerRow
                      column_count={columns.length}
                      height={bottom_spacer_height}
                    />
                  ) : null}
                </SortableContext>
              </TableBody>
            </Table>
            <DragOverlay>{overlay}</DragOverlay>
          </DndContext>
        </ScrollArea>
        {selection_box_active ? (
          <div ref={selection_box_element_ref} className="app-table__selection-box" />
        ) : null}
      </div>
    </div>
  );
}

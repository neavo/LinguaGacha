import { resolve_app_table_row_zebra } from "./app-table-virtualization";
import { useSortable } from "@dnd-kit/react/sortable";
import { SORTABLE_OPTIONS } from "@frontend/widgets/interactions/sortable";
import { AppContextMenu, AppContextMenuTrigger } from "@frontend/widgets/app-context-menu";
import { AppTableDragIndicator } from "./app-table-drag-indicator";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useState, type CSSProperties, type MouseEvent, type ReactNode, type Ref } from "react";

import { cn } from "@frontend/shadcn/classnames";
import { AppButton } from "@frontend/widgets/app-button";
import { TableCell, TableHead, TableRow } from "@frontend/shadcn/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import type {
  AppTableColumn,
  AppTableCellPayload,
  AppTableRowEvent,
  AppTableDataColumn,
  AppTableSortDirection,
} from "@frontend/widgets/app-table/app-table-types";

/** 排序按钮提示下一次操作；禁用排序时不占用操作位。 */
function resolve_sort_action_label(args: {
  direction: AppTableSortDirection | null;
  column: AppTableDataColumn<unknown>;
}): string | null {
  if (args.column.sortable === undefined || args.column.sortable.disabled) {
    return null;
  }

  if (args.direction === null) {
    return args.column.sortable.action_labels.ascending;
  }

  if (args.direction === "ascending") {
    return args.column.sortable.action_labels.descending;
  }

  return args.column.sortable.action_labels.clear;
}
/** 表头组合排序入口与自定义内容，无操作时将预留空间还给标题。 */
export function AppTableHeadCell<Row>(args: {
  column: AppTableColumn<Row>;
  direction: AppTableSortDirection | null;
  on_cycle_sort: (() => void) | null;
  has_divider: boolean;
}): JSX.Element {
  if (args.column.kind === "drag") {
    return (
      <TableHead
        className={cn("app-table__head-cell app-table__drag-head", args.column.head_class_name)}
        data-align={args.column.align ?? "center"}
        data-divider={args.has_divider ? "true" : undefined}
      >
        <div className="app-table__head-content app-table__head-content--compact">
          <span className="app-table__head-label">{args.column.title}</span>
        </div>
      </TableHead>
    );
  }

  const action_label = resolve_sort_action_label({
    direction: args.direction,
    column: args.column as AppTableDataColumn<unknown>,
  });
  const Icon =
    args.direction === "ascending"
      ? ArrowUp
      : args.direction === "descending"
        ? ArrowDown
        : ArrowUpDown;
  const trigger =
    action_label === null || args.on_cycle_sort === null ? null : (
      <span className="inline-flex">
        <AppButton
          type="button"
          variant={args.direction === null ? "ghost" : "secondary"}
          size="icon-xs"
          data-direction={args.direction ?? undefined}
          data-active={args.direction === null ? undefined : "true"}
          className="app-table__sort-trigger"
          aria-label={action_label}
          onClick={args.on_cycle_sort}
        >
          <Icon aria-hidden="true" data-icon="inline-start" />
        </AppButton>
      </span>
    );
  const resolved_trigger =
    trigger === null ? null : (
      <Tooltip>
        <TooltipTrigger render={trigger} />
        <TooltipContent>
          <p>{action_label}</p>
        </TooltipContent>
      </Tooltip>
    );
  const head_content = args.column.render_head?.({
    direction: args.direction,
    trigger: resolved_trigger,
  }) ?? (
    <div
      className={cn(
        "app-table__head-content",
        resolved_trigger === null && "app-table__head-content--compact",
      )}
    >
      <span className="app-table__head-label">{args.column.title}</span>
      {resolved_trigger === null ? null : (
        <span className="app-table__head-action">{resolved_trigger}</span>
      )}
    </div>
  );

  return (
    <TableHead
      className={cn("app-table__head-cell", args.column.head_class_name)}
      data-align={args.column.align ?? "left"}
      data-divider={args.has_divider ? "true" : undefined}
    >
      {head_content}
    </TableHead>
  );
}
/** 以单个跨列单元格承载虚拟列表的滚动高度。 */
export function AppTableSpacerRow(props: { column_count: number; height: number }): JSX.Element {
  return (
    <TableRow aria-hidden="true" className="app-table__row app-table__spacer-row">
      <TableCell colSpan={props.column_count} className="app-table__spacer-cell">
        <div className="app-table__spacer-fill" style={{ height: props.height }} />
      </TableCell>
    </TableRow>
  );
}

/** 独立列和嵌入手柄共用内容入口，正文、占位与浮层保持相同结构。 */
function AppTableCellContent<Row>(props: {
  column: AppTableColumn<Row>;
  children?: ReactNode;
  row_number: number;
  disabled: boolean;
  dragging: boolean;
  handle_ref?: Ref<HTMLButtonElement>;
  show_tooltip: boolean;
}): ReactNode {
  if (props.column.kind !== "drag" && !props.column.drag_handle) {
    return props.children;
  }
  const indicator = (
    <AppTableDragIndicator
      row_number={props.row_number}
      disabled={props.disabled}
      dragging={props.dragging}
      handle_ref={props.handle_ref}
      show_tooltip={props.show_tooltip}
    />
  );
  return props.column.kind === "drag" ? (
    indicator
  ) : (
    <div className="app-table__cell-with-drag">
      {indicator}
      <div className="app-table__cell-content">{props.children}</div>
    </div>
  );
}
/** 虚拟行未加载时保留列宽、斑马纹和分隔线。 */
export function AppTablePlaceholderRow<Row>(props: {
  columns: AppTableColumn<Row>[];
  row_index: number;
  height: number;
}): JSX.Element {
  const row_style: CSSProperties = {
    height: props.height,
  };

  return (
    <TableRow
      aria-hidden="true"
      data-row-index={props.row_index}
      data-zebra={props.row_index % 2 === 1 ? "even" : "odd"}
      className="app-table__row app-table__placeholder-row"
      style={row_style}
    >
      {props.columns.map((column, column_index) => {
        const placeholder = (
          <AppTableCellContent
            column={column}
            row_number={props.row_index + 1}
            disabled
            dragging={false}
            show_tooltip={false}
          >
            {column.kind === "data"
              ? (column.render_placeholder?.() ?? <span>{"\u00A0"}</span>)
              : null}
          </AppTableCellContent>
        );
        return (
          <TableCell
            key={`${column.id}-placeholder-${column_index.toString()}`}
            className={cn(
              "app-table__placeholder-cell",
              column.kind === "drag" || column.drag_handle ? "app-table__drag-cell" : undefined,
              column.cell_class_name,
            )}
            data-align={column.align ?? (column.kind === "drag" ? "center" : "left")}
            data-divider={column_index < props.columns.length - 1 ? "true" : undefined}
          >
            <span className="app-table__placeholder-content">{placeholder}</span>
          </TableCell>
        );
      })}
    </TableRow>
  );
}

type AppTableSortableRowProps<Row> = {
  row: Row;
  row_id: string;
  row_index: number;
  row_number: number; // 序号跟随条目身份，位置索引供虚拟化与碰撞使用。
  overlay_source: boolean; // 与 AppTable 浮层使用同一显示条件。
  columns: AppTableColumn<Row>[];
  selected: boolean;
  active: boolean;
  drag_enabled: boolean;
  can_drag: boolean;
  row_class_name?: string;
  render_row_context_menu?: (payload: AppTableRowEvent<Row>) => ReactNode;
  should_ignore_click: () => boolean;
  on_row_click: (row_id: string, row_index: number, event: MouseEvent<HTMLTableRowElement>) => void;
  on_row_context: (row_id: string) => void;
  on_row_activate?: (row_id: string) => void;
  register_row_element: (row_id: string, row_element: HTMLTableRowElement | null) => void;
};

const APP_TABLE_IGNORE_ROW_CLICK_SELECTOR = '[data-app-table-ignore-row-click="true"]';
/** 行内手柄与控件不触发行选择或双击激活。 */
function should_ignore_app_table_row_click(target: HTMLElement): boolean {
  return target.closest(APP_TABLE_IGNORE_ROW_CLICK_SELECTOR) !== null;
}
/** 普通行与拖拽浮层共用单元格结构，展示位置通过 payload 交给页面。 */
export function AppTableRowCells<Row>(props: {
  columns: AppTableColumn<Row>[];
  payload: AppTableCellPayload<Row>;
  dragging: boolean;
  row_number: number;
  drag_disabled: boolean;
  handle_ref?: Ref<HTMLButtonElement>;
}): JSX.Element {
  return (
    <>
      {props.columns.map((column, index) => (
        <TableCell
          key={column.id}
          className={cn(
            "app-table__body-cell",
            column.kind === "drag" || column.drag_handle ? "app-table__drag-cell" : undefined,
            column.cell_class_name,
          )}
          data-align={column.align ?? (column.kind === "drag" ? "center" : "left")}
          data-divider={index < props.columns.length - 1 ? "true" : undefined}
        >
          <AppTableCellContent
            column={column}
            row_number={props.row_number}
            disabled={props.drag_disabled}
            dragging={props.dragging}
            handle_ref={props.handle_ref}
            show_tooltip={props.payload.presentation === "body"}
          >
            {column.kind === "data" ? column.render_cell(props.payload) : null}
          </AppTableCellContent>
        </TableCell>
      ))}
    </>
  );
}
/** 行拥有触发器与打开状态，菜单内容按需创建，避免逐行扫描完整选区。 */
export function AppTableSortableRow<Row>(props: AppTableSortableRowProps<Row>): JSX.Element {
  const [context_menu_open, set_context_menu_open] = useState(false);
  const {
    isDragSource: isDragging,
    handleRef,
    ref: setNodeRef,
  } = useSortable({
    ...SORTABLE_OPTIONS,
    id: props.row_id,
    index: props.row_index,
    disabled: !props.drag_enabled || !props.can_drag,
  });

  const row_event: AppTableRowEvent<Row> = {
    row: props.row,
    row_id: props.row_id,
    row_index: props.row_index,
  };

  /** 同一 DOM 同时供排序测量和表格选区定位使用。 */
  const set_row_element = (row_element: HTMLTableRowElement | null): void => {
    setNodeRef(row_element);
    props.register_row_element(props.row_id, row_element);
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
      data-overlay-source={props.overlay_source ? "true" : undefined}
      className={cn("app-table__row", props.row_class_name)}
      onClick={(event) => {
        if (props.should_ignore_click()) {
          event.preventDefault();
          return;
        }

        if (
          event.target instanceof HTMLElement &&
          should_ignore_app_table_row_click(event.target)
        ) {
          return;
        }

        props.on_row_click(props.row_id, props.row_index, event);
      }}
      onContextMenu={(event) => {
        if (
          event.target instanceof HTMLElement &&
          should_ignore_app_table_row_click(event.target)
        ) {
          return;
        }

        props.on_row_context(props.row_id);
      }}
      onDoubleClick={(event) => {
        if (props.should_ignore_click()) {
          return;
        }

        if (
          event.target instanceof HTMLElement &&
          should_ignore_app_table_row_click(event.target)
        ) {
          return;
        }

        props.on_row_activate?.(props.row_id);
      }}
    >
      <AppTableRowCells
        columns={props.columns}
        payload={{
          ...row_event,
          presentation: "body",
        }}
        dragging={isDragging}
        row_number={props.row_number}
        handle_ref={handleRef}
        drag_disabled={!props.drag_enabled || !props.can_drag}
      />
    </TableRow>
  );

  if (props.render_row_context_menu === undefined) {
    return row_body;
  }

  return (
    <AppContextMenu
      onOpenChange={(next_open) => {
        set_context_menu_open(next_open);
        if (next_open) {
          props.on_row_context(props.row_id);
        }
      }}
    >
      <AppContextMenuTrigger render={row_body} />
      {context_menu_open ? props.render_row_context_menu(row_event) : null}
    </AppContextMenu>
  );
}

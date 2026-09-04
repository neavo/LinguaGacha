import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import type { JSX, ReactNode } from "react";

export type AppTableSelectionMode = "none" | "single" | "multiple";

export type AppTableSortDirection = "ascending" | "descending";

export type AppTableSortState = {
  column_id: string;
  direction: AppTableSortDirection;
};

export type AppTableSelectionState = {
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
};

export type AppTableSelectionChange = AppTableSelectionState;

type AppTableSortActionLabels = {
  ascending: string;
  descending: string;
  clear: string;
};

export type AppTableRowEvent<Row> = {
  row: Row;
  row_id: string;
  row_index: number;
};

export type AppTableRowModel<Row> = {
  row_count: number;
  loaded_row_ids: string[];
  get_row_at_index: (index: number) => Row | undefined;
  get_row_id_at_index: (index: number) => string | undefined;
  resolve_row_index: (row_id: string) => number | undefined;
  // resolve_row_index_async 供虚拟/worker 视图按 row id 懒解析未加载行的索引。
  resolve_row_index_async?: (row_id: string) => number | undefined | Promise<number | undefined>;
  resolve_row_ids_range?: (range: { start: number; count: number }) => string[] | Promise<string[]>;
  on_visible_range_change?: (range: { start: number; count: number }) => void;
};

type AppTableCellPresentation = "body" | "overlay";

export type AppTableCellPayload<Row> = AppTableRowEvent<Row> & {
  active: boolean;
  selected: boolean;
  dragging: boolean;
  can_drag: boolean;
  presentation: AppTableCellPresentation;
};

export type AppTableDragHandle = {
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  disabled: boolean;
};

export type AppTableDragCellPayload<Row> = AppTableCellPayload<Row> & {
  drag_handle: AppTableDragHandle | null;
};

type AppTableColumnBase = {
  id: string;
  width?: number;
  align?: "left" | "center" | "right";
  head_class_name?: string;
  cell_class_name?: string;
};

type AppTableDragColumn<Row> = AppTableColumnBase & {
  kind: "drag";
  title?: ReactNode;
  render_cell: (payload: AppTableDragCellPayload<Row>) => ReactNode;
  render_placeholder?: () => ReactNode;
};

export type AppTableDataColumn<Row> = AppTableColumnBase & {
  kind: "data";
  title: ReactNode;
  sortable?: {
    disabled?: boolean;
    action_labels: AppTableSortActionLabels;
  };
  render_head?: (payload: {
    direction: AppTableSortDirection | null;
    trigger: JSX.Element | null;
  }) => ReactNode;
  render_cell: (payload: AppTableCellPayload<Row>) => ReactNode;
  render_placeholder?: () => ReactNode;
};

export type AppTableColumn<Row> = AppTableDragColumn<Row> | AppTableDataColumn<Row>;

// 用 revision 区分同一行的多次主动定位请求。
export type AppTableScrollTarget = {
  row_id: string;
  revision: number;
};

// 用 revision 区分每次刷新，row_id 为空时表示显式取消保持滚动。
export type AppTableScrollAnchor = {
  row_id: string | null;
  revision: number;
};

export type AppTableProps<Row> = {
  rows: Row[];
  columns: AppTableColumn<Row>[];
  selection_mode: AppTableSelectionMode;
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
  sort_state: AppTableSortState | null;
  get_row_id: (row: Row, index: number) => string;
  row_model?: AppTableRowModel<Row>;
  // scroll_to_row 主动把目标行滚入视口，不改变表格选区或键盘焦点。
  scroll_to_row?: AppTableScrollTarget;
  // preserve_scroll_anchor 是数据刷新期间保持视觉偏移的滚动锚点。
  preserve_scroll_anchor?: AppTableScrollAnchor;
  get_row_can_drag?: (row: Row, index: number) => boolean;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_selection_error?: (error: unknown) => void;
  on_sort_change: (payload: AppTableSortState | null) => void;
  // 回调存在即开放拖拽；表格维持临时顺序直到页面完成持久化与权威数据刷新。
  on_reorder?: (ordered_row_ids: string[]) => Promise<void>;
  on_row_double_click?: (payload: AppTableRowEvent<Row>) => void;
  render_row_context_menu?: (payload: AppTableRowEvent<Row>) => ReactNode;
  box_selection_enabled?: boolean;
  virtual_overscan?: number;
  row_height?: number;
  placeholder_row_strategy?: "fill-viewport";
  className?: string;
  table_class_name?: string;
  row_class_name?: (payload: AppTableRowEvent<Row>) => string | undefined;
};

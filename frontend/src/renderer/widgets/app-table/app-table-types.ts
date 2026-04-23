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

type AppTableReorderChange<Row> = {
  active_row_id: string;
  over_row_id: string;
  active_row_ids: string[];
  ordered_row_ids: string[];
  rows: Row[];
};

export type AppTableRowEvent<Row> = {
  row: Row;
  row_id: string;
  row_index: number;
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

export type AppTableProps<Row> = {
  rows: Row[];
  columns: AppTableColumn<Row>[];
  selection_mode: AppTableSelectionMode;
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
  sort_state: AppTableSortState | null;
  drag_enabled: boolean;
  get_row_id: (row: Row, index: number) => string;
  get_row_can_drag?: (row: Row, index: number) => boolean;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_sort_change: (payload: AppTableSortState | null) => void;
  on_reorder: (payload: AppTableReorderChange<Row>) => void | Promise<void>;
  on_row_double_click?: (payload: AppTableRowEvent<Row>) => void;
  render_row_context_menu?: (payload: AppTableRowEvent<Row>) => ReactNode;
  ignore_row_click_target?: (target_element: HTMLElement) => boolean;
  ignore_box_select_target?: (target_element: HTMLElement) => boolean;
  box_selection_enabled?: boolean;
  virtual_overscan?: number;
  estimated_row_height?: number;
  placeholder_row_strategy?: "fill-viewport";
  className?: string;
  table_class_name?: string;
  row_class_name?: (payload: AppTableRowEvent<Row>) => string | undefined;
};

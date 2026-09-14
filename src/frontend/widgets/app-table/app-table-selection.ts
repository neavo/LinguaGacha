import type {
  AppTableSelectionChange,
  AppTableSelectionMode,
  AppTableSelectionState,
} from "@frontend/widgets/app-table/app-table-types";

function dedupe_row_ids(row_ids: string[]): string[] {
  return Array.from(new Set(row_ids));
}

/** 右键和拖拽共用目标：多选模式下操作已选行时作用于整组，其余情况只作用于该行。 */
export function resolve_app_table_target_row_ids<Id extends string>(
  row_id: Id,
  selected_row_ids: Id[],
  selection_mode: AppTableSelectionMode,
): Id[] {
  return selection_mode === "multiple" && selected_row_ids.includes(row_id)
    ? selected_row_ids
    : [row_id];
}

/** 选区顺序、活动行和锚点共同决定交互状态是否变化。 */
export function are_app_table_selection_states_equal(
  left_state: AppTableSelectionState,
  right_state: AppTableSelectionState,
): boolean {
  if (left_state.active_row_id !== right_state.active_row_id) {
    return false;
  }

  if (left_state.anchor_row_id !== right_state.anchor_row_id) {
    return false;
  }

  if (left_state.selected_row_ids.length !== right_state.selected_row_ids.length) {
    return false;
  }

  return left_state.selected_row_ids.every((row_id, index) => {
    return row_id === right_state.selected_row_ids[index];
  });
}

/** 完整列表可裁掉失效身份；远端窗口传 null，保留尚未加载的选择。 */
export function normalize_app_table_selection_state(
  state: AppTableSelectionState,
  ordered_row_ids: string[] | null,
): AppTableSelectionState {
  if (ordered_row_ids === null) {
    return {
      selected_row_ids: dedupe_row_ids(state.selected_row_ids),
      active_row_id: state.active_row_id,
      anchor_row_id: state.anchor_row_id,
    };
  }

  const row_id_set = new Set(ordered_row_ids);
  const selected_row_ids = dedupe_row_ids(state.selected_row_ids).filter((row_id) => {
    return row_id_set.has(row_id);
  });
  const active_row_id =
    state.active_row_id !== null && row_id_set.has(state.active_row_id)
      ? state.active_row_id
      : null;
  const anchor_row_id =
    state.anchor_row_id !== null && row_id_set.has(state.anchor_row_id)
      ? state.anchor_row_id
      : null;

  return {
    selected_row_ids,
    active_row_id,
    anchor_row_id,
  };
}

/** 范围包含两端；锚点失效时从目标行重新建立范围。 */
function collect_app_table_range_selection(
  ordered_row_ids: string[],
  anchor_row_id: string | null,
  target_row_id: string,
): string[] {
  const anchor_index = anchor_row_id === null ? -1 : ordered_row_ids.indexOf(anchor_row_id);
  const target_index = ordered_row_ids.indexOf(target_row_id);

  if (target_index < 0) {
    return [];
  }

  if (anchor_index < 0) {
    return [target_row_id];
  }

  const start_index = Math.min(anchor_index, target_index);
  const end_index = Math.max(anchor_index, target_index);
  return ordered_row_ids.slice(start_index, end_index + 1);
}

/** 按单选、范围扩选和逐行切换裁决点击选区。 */
export function build_app_table_click_selection_change(args: {
  selection_mode: AppTableSelectionMode;
  ordered_row_ids: string[];
  current_state: AppTableSelectionState;
  target_row_id: string;
  extend: boolean;
  range: boolean;
}): AppTableSelectionChange {
  if (args.selection_mode === "none") {
    return {
      selected_row_ids: [],
      active_row_id: args.target_row_id,
      anchor_row_id: null,
    };
  }

  if (args.selection_mode === "single") {
    return {
      selected_row_ids: [args.target_row_id],
      active_row_id: args.target_row_id,
      anchor_row_id: args.target_row_id,
    };
  }

  if (args.range) {
    const anchor_row_id =
      args.current_state.anchor_row_id ?? args.current_state.active_row_id ?? args.target_row_id;
    return {
      selected_row_ids: collect_app_table_range_selection(
        args.ordered_row_ids,
        anchor_row_id,
        args.target_row_id,
      ),
      active_row_id: args.target_row_id,
      anchor_row_id,
    };
  }

  if (args.extend) {
    const selected_row_ids = args.current_state.selected_row_ids.includes(args.target_row_id)
      ? args.current_state.selected_row_ids.filter((row_id) => row_id !== args.target_row_id)
      : [...args.current_state.selected_row_ids, args.target_row_id];

    return {
      selected_row_ids,
      active_row_id: args.target_row_id,
      anchor_row_id: args.target_row_id,
    };
  }

  return {
    selected_row_ids: [args.target_row_id],
    active_row_id: args.target_row_id,
    anchor_row_id: args.target_row_id,
  };
}

/** 右键已选组时保留选区和锚点，并把目标行设为活动行。 */
export function build_app_table_context_selection_change(args: {
  selection_mode: AppTableSelectionMode;
  current_state: AppTableSelectionState;
  target_row_id: string;
}): AppTableSelectionChange {
  if (args.selection_mode === "none") {
    return {
      selected_row_ids: [],
      active_row_id: args.target_row_id,
      anchor_row_id: args.current_state.anchor_row_id,
    };
  }

  if (
    args.selection_mode === "multiple" &&
    args.current_state.selected_row_ids.includes(args.target_row_id)
  ) {
    return {
      selected_row_ids: args.current_state.selected_row_ids,
      active_row_id: args.target_row_id,
      anchor_row_id: args.current_state.anchor_row_id ?? args.target_row_id,
    };
  }

  return {
    selected_row_ids: [args.target_row_id],
    active_row_id: args.target_row_id,
    anchor_row_id: args.target_row_id,
  };
}

/** 框选以首尾建立锚点和活动行，空框保留原定位身份。 */
export function build_app_table_box_selection_change(args: {
  current_state: AppTableSelectionState;
  next_row_ids: string[];
}): AppTableSelectionChange {
  const next_active_row_id = args.next_row_ids.at(-1) ?? null;
  const next_anchor_row_id = args.next_row_ids[0] ?? null;

  return {
    selected_row_ids: args.next_row_ids,
    active_row_id: next_active_row_id ?? args.current_state.active_row_id,
    anchor_row_id: next_anchor_row_id ?? args.current_state.anchor_row_id,
  };
}

/** 全选保留已有活动行和锚点，缺省时使用首行。 */
export function build_app_table_select_all_selection_change(args: {
  ordered_row_ids: string[];
  current_state: AppTableSelectionState;
}): AppTableSelectionChange {
  const fallback_anchor_row_id = args.ordered_row_ids[0] ?? null;
  const fallback_active_row_id = args.current_state.active_row_id ?? fallback_anchor_row_id;

  return {
    selected_row_ids: args.ordered_row_ids,
    active_row_id: fallback_active_row_id,
    anchor_row_id: args.current_state.anchor_row_id ?? fallback_anchor_row_id,
  };
}

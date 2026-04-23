import type {
  AppTableSelectionChange,
  AppTableSelectionMode,
  AppTableSelectionState,
} from "@/widgets/app-table/app-table-types";

function dedupe_row_ids(row_ids: string[]): string[] {
  return Array.from(new Set(row_ids));
}

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

export function normalize_app_table_selection_state(
  state: AppTableSelectionState,
  ordered_row_ids: string[],
): AppTableSelectionState {
  const visible_row_id_set = new Set(ordered_row_ids);
  const selected_row_ids = dedupe_row_ids(state.selected_row_ids).filter((row_id) => {
    return visible_row_id_set.has(row_id);
  });
  const active_row_id =
    state.active_row_id !== null && visible_row_id_set.has(state.active_row_id)
      ? state.active_row_id
      : null;
  const anchor_row_id =
    state.anchor_row_id !== null && visible_row_id_set.has(state.anchor_row_id)
      ? state.anchor_row_id
      : null;

  return {
    selected_row_ids,
    active_row_id,
    anchor_row_id,
  };
}

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

type AppTableKeyboardNavigationAction = "previous" | "next" | "first" | "last";

function resolve_keyboard_navigation_target_index(args: {
  ordered_row_ids: string[];
  current_state: AppTableSelectionState;
  action: AppTableKeyboardNavigationAction;
}): number {
  const row_count = args.ordered_row_ids.length;
  const current_index =
    args.current_state.active_row_id === null
      ? -1
      : args.ordered_row_ids.indexOf(args.current_state.active_row_id);

  if (row_count === 0) {
    return -1;
  } else if (args.action === "first") {
    return 0;
  } else if (args.action === "last") {
    return row_count - 1;
  } else if (args.action === "previous") {
    if (current_index < 0) {
      return row_count - 1;
    } else {
      return Math.max(current_index - 1, 0);
    }
  } else if (current_index < 0) {
    return 0;
  } else {
    return Math.min(current_index + 1, row_count - 1);
  }
}

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

export function build_app_table_keyboard_selection_change(args: {
  selection_mode: AppTableSelectionMode;
  ordered_row_ids: string[];
  current_state: AppTableSelectionState;
  action: AppTableKeyboardNavigationAction;
  extend: boolean;
}): AppTableSelectionChange {
  const target_index = resolve_keyboard_navigation_target_index({
    ordered_row_ids: args.ordered_row_ids,
    current_state: args.current_state,
    action: args.action,
  });
  const target_row_id = args.ordered_row_ids[target_index] ?? null;

  if (target_row_id === null) {
    return args.current_state;
  } else if (args.selection_mode === "none") {
    return {
      selected_row_ids: [],
      active_row_id: target_row_id,
      anchor_row_id: null,
    };
  } else if (args.selection_mode === "single") {
    return {
      selected_row_ids: [target_row_id],
      active_row_id: target_row_id,
      anchor_row_id: target_row_id,
    };
  } else if (args.extend) {
    const anchor_row_id =
      args.current_state.anchor_row_id ?? args.current_state.active_row_id ?? target_row_id;

    return {
      selected_row_ids: collect_app_table_range_selection(
        args.ordered_row_ids,
        anchor_row_id,
        target_row_id,
      ),
      active_row_id: target_row_id,
      anchor_row_id,
    };
  } else {
    return {
      selected_row_ids: [target_row_id],
      active_row_id: target_row_id,
      anchor_row_id: target_row_id,
    };
  }
}

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

import type { AppTableSelectionMode } from '@/widgets/app-table/app-table-types'

export function resolve_app_table_drag_group_row_ids(args: {
  selection_mode: AppTableSelectionMode
  active_row_id: string
  selected_row_ids: string[]
}): string[] {
  if (
    args.selection_mode === 'multiple'
    && args.selected_row_ids.includes(args.active_row_id)
  ) {
    return args.selected_row_ids
  }

  return [args.active_row_id]
}

export function build_app_table_reordered_row_ids(args: {
  ordered_row_ids: string[]
  moving_row_ids: string[]
  over_row_id: string
}): string[] {
  const moving_row_id_set = new Set(args.moving_row_ids)
  const ordered_moving_row_ids = args.ordered_row_ids.filter((row_id) => {
    return moving_row_id_set.has(row_id)
  })

  if (ordered_moving_row_ids.length === 0 || moving_row_id_set.has(args.over_row_id)) {
    return args.ordered_row_ids
  }

  const remaining_row_ids = args.ordered_row_ids.filter((row_id) => {
    return !moving_row_id_set.has(row_id)
  })
  const over_row_index = args.ordered_row_ids.findIndex((row_id) => {
    return row_id === args.over_row_id
  })
  const insert_index = remaining_row_ids.findIndex((row_id) => {
    return row_id === args.over_row_id
  })
  let last_moving_index = -1

  for (let index = args.ordered_row_ids.length - 1; index >= 0; index -= 1) {
    const row_id = args.ordered_row_ids[index]
    if (row_id !== undefined && moving_row_id_set.has(row_id)) {
      last_moving_index = index
      break
    }
  }

  const should_insert_after_over_row = over_row_index > last_moving_index
  const normalized_insert_index = insert_index < 0
    ? remaining_row_ids.length
    : insert_index + (should_insert_after_over_row ? 1 : 0)
  const next_row_ids = [...remaining_row_ids]

  next_row_ids.splice(normalized_insert_index, 0, ...ordered_moving_row_ids)
  return next_row_ids
}

import type {
  TextReplacementEntry,
  TextReplacementEntryId,
} from '@/pages/text-replacement-page/types'

export function build_text_replacement_entry_id(
  entry: TextReplacementEntry,
  index: number,
): TextReplacementEntryId {
  if (typeof entry.entry_id === 'string' && entry.entry_id !== '') {
    return entry.entry_id
  }

  return `${entry.src.trim()}::${index.toString()}`
}

export function collect_text_replacement_range_selection(
  ordered_entry_ids: TextReplacementEntryId[],
  anchor_entry_id: TextReplacementEntryId | null,
  target_entry_id: TextReplacementEntryId,
): TextReplacementEntryId[] {
  const anchor_index = anchor_entry_id === null
    ? -1
    : ordered_entry_ids.indexOf(anchor_entry_id)
  const target_index = ordered_entry_ids.indexOf(target_entry_id)

  if (target_index < 0) {
    return []
  }

  if (anchor_index < 0) {
    return [target_entry_id]
  }

  const start_index = Math.min(anchor_index, target_index)
  const end_index = Math.max(anchor_index, target_index)
  return ordered_entry_ids.slice(start_index, end_index + 1)
}

export function are_text_replacement_entry_ids_equal(
  left_entry_ids: TextReplacementEntryId[],
  right_entry_ids: TextReplacementEntryId[],
): boolean {
  if (left_entry_ids === right_entry_ids) {
    return true
  }

  if (left_entry_ids.length !== right_entry_ids.length) {
    return false
  }

  return left_entry_ids.every((entry_id, index) => {
    return entry_id === right_entry_ids[index]
  })
}

export function reorder_text_replacement_selected_group(
  entries: TextReplacementEntry[],
  ordered_entry_ids: TextReplacementEntryId[],
  selected_entry_ids: TextReplacementEntryId[],
  active_entry_id: TextReplacementEntryId,
  over_entry_id: TextReplacementEntryId,
): TextReplacementEntry[] {
  const selected_id_set = new Set(
    selected_entry_ids.includes(active_entry_id)
      ? selected_entry_ids
      : [active_entry_id],
  )
  const indexed_entries = ordered_entry_ids.map((entry_id, index) => ({
    entry_id,
    entry: entries[index],
  }))
  const moving_entries = indexed_entries.filter((item) => {
    return selected_id_set.has(item.entry_id)
  })

  if (moving_entries.length === 0 || selected_id_set.has(over_entry_id)) {
    return entries
  }

  const remaining_entries = indexed_entries.filter((item) => {
    return !selected_id_set.has(item.entry_id)
  })
  const over_entry_index = ordered_entry_ids.findIndex((entry_id) => {
    return entry_id === over_entry_id
  })
  const insert_index = remaining_entries.findIndex((item) => {
    return item.entry_id === over_entry_id
  })
  let last_moving_index = -1

  for (let index = ordered_entry_ids.length - 1; index >= 0; index -= 1) {
    const entry_id = ordered_entry_ids[index]
    if (entry_id !== undefined && selected_id_set.has(entry_id)) {
      last_moving_index = index
      break
    }
  }

  const should_insert_after_over_entry = over_entry_index > last_moving_index
  const normalized_insert_index = insert_index < 0
    ? remaining_entries.length
    : insert_index + (should_insert_after_over_entry ? 1 : 0)
  const next_entries = [...remaining_entries]

  next_entries.splice(normalized_insert_index, 0, ...moving_entries)
  return next_entries.map((item) => item.entry)
}

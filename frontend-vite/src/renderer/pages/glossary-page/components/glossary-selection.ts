import type { GlossaryEntry, GlossaryEntryId } from '@/pages/glossary-page/types'

export function build_glossary_entry_id(
  entry: GlossaryEntry,
  index: number,
): GlossaryEntryId {
  if (typeof entry.entry_id === 'string' && entry.entry_id !== '') {
    return entry.entry_id
  }

  return `${entry.src.trim()}::${index.toString()}`
}

export function collect_range_selection(
  ordered_entry_ids: GlossaryEntryId[],
  anchor_entry_id: GlossaryEntryId | null,
  target_entry_id: GlossaryEntryId,
): GlossaryEntryId[] {
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

export function reorder_selected_group(
  entries: GlossaryEntry[],
  ordered_entry_ids: GlossaryEntryId[],
  selected_entry_ids: GlossaryEntryId[],
  active_entry_id: GlossaryEntryId,
  over_entry_id: GlossaryEntryId,
): GlossaryEntry[] {
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
  const remaining_entries = indexed_entries.filter((item) => {
    return !selected_id_set.has(item.entry_id)
  })
  const insert_index = remaining_entries.findIndex((item) => {
    return item.entry_id === over_entry_id
  })
  const normalized_insert_index = insert_index < 0
    ? remaining_entries.length
    : insert_index
  const next_entries = [...remaining_entries]

  next_entries.splice(normalized_insert_index, 0, ...moving_entries)
  return next_entries.map((item) => item.entry)
}

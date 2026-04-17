import type { TextPreserveEntry } from '@/pages/text-preserve-page/types'

type TextPreserveMergeReport = {
  added: number
  updated: number
  deduped: number
}

type TextPreserveMergeResult = {
  merged_entries: TextPreserveEntry[]
  report: TextPreserveMergeReport
}

function normalize_entry(entry: TextPreserveEntry): TextPreserveEntry {
  return {
    entry_id: entry.entry_id,
    src: String(entry.src ?? '').trim(),
    info: String(entry.info ?? '').trim(),
  }
}

function merge_into_base(
  base: TextPreserveEntry,
  other: TextPreserveEntry,
): boolean {
  let changed = false

  if (base.src !== other.src) {
    base.src = other.src
    changed = true
  }

  if (base.info !== other.info) {
    base.info = other.info
    changed = true
  }

  return changed
}

export function merge_text_preserve_entries(
  existing_entries: TextPreserveEntry[],
  incoming_entries: TextPreserveEntry[],
): TextPreserveMergeResult {
  const grouped_entries = new Map<string, Array<{
    entry: TextPreserveEntry
    order: number
    is_existing: boolean
  }>>()

  const append_entry = (
    raw_entry: TextPreserveEntry,
    order: number,
    is_existing: boolean,
  ): void => {
    const entry = normalize_entry(raw_entry)
    const key = entry.src
    const group = grouped_entries.get(key)
    const item = { entry, order, is_existing }
    if (group === undefined) {
      grouped_entries.set(key, [item])
    } else {
      group.push(item)
    }
  }

  existing_entries.forEach((entry, index) => {
    append_entry(entry, index, true)
  })
  incoming_entries.forEach((entry, index) => {
    append_entry(entry, existing_entries.length + index, false)
  })

  const existing_key_set = new Set(
    existing_entries.map((entry) => {
      return String(entry.src ?? '').trim()
    }),
  )
  const kept_entries: Array<{
    key: string
    order: number
    entry: TextPreserveEntry
  }> = []
  let updated = 0
  let deduped = 0

  for (const [key, items] of grouped_entries) {
    const sorted_items = [...items].sort((left_item, right_item) => {
      return left_item.order - right_item.order
    })
    const base = { ...sorted_items[0].entry }

    for (const item of sorted_items.slice(1)) {
      deduped += 1
      if (merge_into_base(base, item.entry)) {
        updated += 1
      }
    }

    kept_entries.push({
      key,
      order: sorted_items[0].order,
      entry: base,
    })
  }

  kept_entries.sort((left_entry, right_entry) => {
    return left_entry.order - right_entry.order
  })

  let added = 0
  for (const kept_entry of kept_entries) {
    if (!existing_key_set.has(kept_entry.key)) {
      added += 1
    }
  }

  return {
    merged_entries: kept_entries.map((item) => item.entry),
    report: {
      added,
      updated,
      deduped,
    },
  }
}

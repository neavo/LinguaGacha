import type { TextReplacementEntry } from '@/pages/text-replacement-page/types'

type TextReplacementMergeKey = string

type TextReplacementMergeItem = {
  entry: TextReplacementEntry
  src_norm: string
  src_fold: string
  case_sensitive: boolean
  order: number
  is_existing: boolean
}

type TextReplacementMergeReport = {
  added: number
  updated: number
  deduped: number
}

type TextReplacementMergeResult = {
  merged_entries: TextReplacementEntry[]
  report: TextReplacementMergeReport
}

function normalize_src(src: string | undefined): string {
  return String(src ?? '').trim()
}

function fold_src(src_norm: string): string {
  return src_norm.toLocaleLowerCase()
}

function normalize_entry(entry: TextReplacementEntry): TextReplacementEntry {
  return {
    entry_id: entry.entry_id,
    src: normalize_src(entry.src),
    dst: String(entry.dst ?? '').trim(),
    regex: Boolean(entry.regex),
    case_sensitive: Boolean(entry.case_sensitive),
  }
}

function build_key(
  src_fold: string,
  src_norm: string,
): TextReplacementMergeKey {
  return `${src_fold}::${src_norm}`
}

function merge_into_base(
  base: TextReplacementEntry,
  other: TextReplacementEntry,
): boolean {
  let changed = false
  const next_src = normalize_src(other.src)

  if (next_src !== '' && base.src !== next_src) {
    base.src = next_src
    changed = true
  }

  if (base.dst !== other.dst) {
    base.dst = other.dst
    changed = true
  }

  if (base.regex !== other.regex) {
    base.regex = other.regex
    changed = true
  }

  if (base.case_sensitive !== other.case_sensitive) {
    base.case_sensitive = other.case_sensitive
    changed = true
  }

  return changed
}

function ingest_entries(
  entries: TextReplacementEntry[],
  options: { order_offset: number; is_existing: boolean },
): TextReplacementMergeItem[] {
  const items: TextReplacementMergeItem[] = []

  for (const [index, raw_entry] of entries.entries()) {
    const entry = normalize_entry(raw_entry)
    if (entry.src === '') {
      continue
    }

    items.push({
      entry,
      src_norm: entry.src,
      src_fold: fold_src(entry.src),
      case_sensitive: entry.case_sensitive,
      order: options.order_offset + index,
      is_existing: options.is_existing,
    })
  }

  return items
}

export function merge_text_replacement_entries(
  existing_entries: TextReplacementEntry[],
  incoming_entries: TextReplacementEntry[],
): TextReplacementMergeResult {
  const existing_items = ingest_entries(existing_entries, {
    order_offset: 0,
    is_existing: true,
  })
  const incoming_items = ingest_entries(incoming_entries, {
    order_offset: existing_entries.length,
    is_existing: false,
  })
  const grouped_items = new Map<string, TextReplacementMergeItem[]>()

  for (const item of [...existing_items, ...incoming_items]) {
    const group = grouped_items.get(item.src_fold)
    if (group === undefined) {
      grouped_items.set(item.src_fold, [item])
    } else {
      group.push(item)
    }
  }

  const existing_key_set = new Set<TextReplacementMergeKey>()
  for (const [src_fold, items] of grouped_items) {
    const fold_only = items.some((item) => !item.case_sensitive)
    if (fold_only) {
      if (items.some((item) => item.is_existing)) {
        existing_key_set.add(src_fold)
      }
      continue
    }

    for (const item of items) {
      if (item.is_existing) {
        existing_key_set.add(build_key(src_fold, item.src_norm))
      }
    }
  }

  const kept_entries: Array<{
    key: TextReplacementMergeKey
    order: number
    entry: TextReplacementEntry
  }> = []
  let updated = 0
  let deduped = 0

  for (const [src_fold, raw_items] of grouped_items) {
    const items = [...raw_items].sort((left_item, right_item) => {
      return left_item.order - right_item.order
    })
    const fold_only = items.some((item) => !item.case_sensitive)

    if (fold_only) {
      const base = { ...items[0].entry }
      for (const item of items.slice(1)) {
        deduped += 1
        if (merge_into_base(base, item.entry)) {
          updated += 1
        }
      }
      kept_entries.push({
        key: src_fold,
        order: items[0].order,
        entry: base,
      })
      continue
    }

    const grouped_by_norm = new Map<string, TextReplacementMergeItem[]>()
    for (const item of items) {
      const group = grouped_by_norm.get(item.src_norm)
      if (group === undefined) {
        grouped_by_norm.set(item.src_norm, [item])
      } else {
        group.push(item)
      }
    }

    for (const [src_norm, norm_items] of grouped_by_norm) {
      const base = { ...norm_items[0].entry }
      for (const item of norm_items.slice(1)) {
        deduped += 1
        if (merge_into_base(base, item.entry)) {
          updated += 1
        }
      }
      kept_entries.push({
        key: build_key(src_fold, src_norm),
        order: norm_items[0].order,
        entry: base,
      })
    }
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
    merged_entries: kept_entries.map((kept_entry) => kept_entry.entry),
    report: {
      added,
      updated,
      deduped,
    },
  }
}

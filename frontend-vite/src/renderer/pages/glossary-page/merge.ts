import type { GlossaryEntry } from '@/pages/glossary-page/types'

type GlossaryMergeKey = string

type GlossaryMergeItem = {
  entry: GlossaryEntry
  src_norm: string
  src_fold: string
  case_sensitive: boolean
  order: number
  is_existing: boolean
}

export type GlossaryMergeReport = {
  added: number
  updated: number
  deduped: number
}

export type GlossaryMergeResult = {
  merged_entries: GlossaryEntry[]
  report: GlossaryMergeReport
}

function normalize_src(src: string | undefined): string {
  return String(src ?? '').trim()
}

function fold_src(src_norm: string): string {
  // 为什么不用原值直接判重：旧页会按大小写折叠后的 key 先归组，
  // 这样大小写不敏感规则才能和历史行为保持一致。
  return src_norm.toLocaleLowerCase()
}

function normalize_entry(entry: GlossaryEntry): GlossaryEntry {
  return {
    entry_id: entry.entry_id,
    src: normalize_src(entry.src),
    dst: String(entry.dst ?? '').trim(),
    info: String(entry.info ?? '').trim(),
    case_sensitive: Boolean(entry.case_sensitive),
  }
}

function build_key(src_fold: string, src_norm: string): GlossaryMergeKey {
  return `${src_fold}::${src_norm}`
}

function merge_into_base(base: GlossaryEntry, other: GlossaryEntry): boolean {
  let changed = false
  const next_src = normalize_src(other.src)

  if (next_src !== '' && base.src !== next_src) {
    base.src = next_src
    changed = true
  }

  for (const field of ['dst', 'info'] as const) {
    if (base[field] !== other[field]) {
      base[field] = other[field]
      changed = true
    }
  }

  if (base.case_sensitive !== other.case_sensitive) {
    base.case_sensitive = other.case_sensitive
    changed = true
  }

  return changed
}

function ingest_entries(
  entries: GlossaryEntry[],
  options: { order_offset: number; is_existing: boolean },
): GlossaryMergeItem[] {
  const items: GlossaryMergeItem[] = []

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

export function merge_glossary_entries(
  existing_entries: GlossaryEntry[],
  incoming_entries: GlossaryEntry[],
): GlossaryMergeResult {
  const existing_items = ingest_entries(existing_entries, {
    order_offset: 0,
    is_existing: true,
  })
  const incoming_items = ingest_entries(incoming_entries, {
    order_offset: existing_entries.length,
    is_existing: false,
  })
  const grouped_items = new Map<string, GlossaryMergeItem[]>()

  for (const item of [...existing_items, ...incoming_items]) {
    const group = grouped_items.get(item.src_fold)
    if (group === undefined) {
      grouped_items.set(item.src_fold, [item])
    } else {
      group.push(item)
    }
  }

  const existing_key_set = new Set<GlossaryMergeKey>()
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

  const kept_entries: Array<{ key: GlossaryMergeKey; order: number; entry: GlossaryEntry }> = []
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

    const grouped_by_norm = new Map<string, GlossaryMergeItem[]>()
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

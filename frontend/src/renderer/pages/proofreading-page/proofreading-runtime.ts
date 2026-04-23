import type {
  ProjectStoreQualityState,
  ProjectStoreState,
} from '@/app/project-runtime/project-store'
import type { SettingsSnapshot } from '@/app/state/desktop-runtime-context'
import {
  build_proofreading_row_id,
  clone_proofreading_filter_options,
  compress_proofreading_text,
  create_empty_proofreading_summary,
  normalize_proofreading_filter_options,
  type ProofreadingClientItem,
  type ProofreadingFilterOptions,
  type ProofreadingGlossaryTerm,
  type ProofreadingSnapshot,
} from '@/pages/proofreading-page/types'
import { TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE } from '@/pages/proofreading-page/text-preserve-smart-patterns'

const PROOFREADING_SIMILARITY_THRESHOLD = 0.8
const PROOFREADING_RETRY_THRESHOLD = 2
const PROOFREADING_SKIPPED_WARNING_STATUSES = new Set([
  'NONE',
  'RULE_SKIPPED',
  'LANGUAGE_SKIPPED',
  'EXCLUDED',
  'DUPLICATED',
])
const PROOFREADING_REVIEW_EXCLUDED_STATUSES = new Set([
  'DUPLICATED',
  'RULE_SKIPPED',
])
const HIRAGANA_REGEX = /[\u3040-\u309F]/u
const KATAKANA_REGEX = /[\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F]/u
const HANGEUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF\uD7B0-\uD7FF]/u

type ProofreadingRuntimeGlossaryEntry = {
  src: string
  dst: string
}

type ProofreadingRuntimeItem = {
  item_id: number
  file_path: string
  row_number: number
  src: string
  dst: string
  status: string
  text_type: string
  retry_count: number
}

export type ProofreadingRuntimeInput = {
  project_id: string
  revision: number
  total_item_count: number
  items: ProofreadingRuntimeItem[]
  quality: ProjectStoreQualityState
  settings: Pick<SettingsSnapshot, 'source_language'>
}

function compareRuntimeItems(
  left_item: ProofreadingRuntimeItem,
  right_item: ProofreadingRuntimeItem,
): number {
  const file_result = left_item.file_path.localeCompare(right_item.file_path, 'zh-Hans-CN')
  if (file_result !== 0) {
    return file_result
  }

  const row_result = left_item.row_number - right_item.row_number
  if (row_result !== 0) {
    return row_result
  }

  return left_item.item_id - right_item.item_id
}

function normalizeRuntimeItem(record: unknown): ProofreadingRuntimeItem | null {
  if (typeof record !== 'object' || record === null) {
    return null
  }

  const candidate = record as Record<string, unknown>
  const item_id = Number(candidate.item_id ?? candidate.id ?? 0)
  if (!Number.isInteger(item_id)) {
    return null
  }

  return {
    item_id,
    file_path: String(candidate.file_path ?? ''),
    row_number: Number(candidate.row_number ?? candidate.row ?? 0),
    src: String(candidate.src ?? ''),
    dst: String(candidate.dst ?? ''),
    status: String(candidate.status ?? ''),
    text_type: String(candidate.text_type ?? 'NONE'),
    retry_count: Number(candidate.retry_count ?? 0),
  }
}

function normalizeRegexPatternForJavascript(pattern: string): string {
  return pattern.replace(/\\U([0-9a-fA-F]{8})/gu, (_match, hex: string) => {
    return `\\u{${hex.replace(/^0+/, '') || '0'}}`
  })
}

function createGlobalRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(normalizeRegexPatternForJavascript(pattern), 'giu')
  } catch {
    return null
  }
}

function createTextPreserveRegex(args: {
  mode: string
  text_type: string
  entries: Array<Record<string, unknown>>
}): RegExp | null {
  if (args.mode === 'off') {
    return null
  }

  const raw_patterns = args.mode === 'custom'
    ? args.entries.flatMap((entry) => {
        const pattern = String(entry.src ?? '').trim()
        return pattern === '' ? [] : [pattern]
      })
    : [...(TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE[
      (args.text_type in TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE
        ? args.text_type
        : 'NONE') as keyof typeof TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE
    ] ?? TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE.NONE)]

  const valid_patterns = raw_patterns.flatMap((pattern) => {
    return createGlobalRegex(pattern) === null ? [] : [`(?:${normalizeRegexPatternForJavascript(pattern)})`]
  })
  if (valid_patterns.length === 0) {
    return null
  }

  return createGlobalRegex(valid_patterns.join('|'))
}

function stripPreservedSegments(text: string, sample_regex: RegExp | null): string {
  if (sample_regex === null) {
    return text
  }

  return text.replace(sample_regex, '')
}

function collectNonBlankPreservedSegments(
  text: string,
  sample_regex: RegExp | null,
): string[] {
  if (sample_regex === null) {
    return []
  }

  const segments: string[] = []
  for (const match of text.matchAll(sample_regex)) {
    const segment = match[0]?.replace(/\s+/gu, '') ?? ''
    if (segment !== '') {
      segments.push(segment)
    }
  }
  return segments
}

function replaceAllLiteral(
  text: string,
  search_text: string,
  replace_text: string,
): string {
  if (search_text === '') {
    return text
  }

  return text.split(search_text).join(replace_text)
}

function applyQualityReplacements(
  item: ProofreadingRuntimeItem,
  quality: ProjectStoreQualityState,
): { src_replaced: string; dst_replaced: string } {
  let src_replaced = item.src
  let dst_replaced = item.dst

  if (quality.pre_replacement.enabled) {
    for (const entry of quality.pre_replacement.entries) {
      const search_text = String(entry.src ?? '')
      const replace_text = String(entry.dst ?? '')
      src_replaced = replaceAllLiteral(src_replaced, search_text, replace_text)
    }
  }

  if (quality.post_replacement.enabled) {
    for (const entry of quality.post_replacement.entries) {
      const search_text = String(entry.dst ?? '')
      const replace_text = String(entry.src ?? '')
      dst_replaced = replaceAllLiteral(dst_replaced, search_text, replace_text)
    }
  }

  return {
    src_replaced,
    dst_replaced,
  }
}

function buildGlossaryEntries(quality: ProjectStoreQualityState): ProofreadingRuntimeGlossaryEntry[] {
  if (!quality.glossary.enabled) {
    return []
  }

  return quality.glossary.entries.flatMap((entry) => {
    const src = String(entry.src ?? '').trim()
    const dst = String(entry.dst ?? '')
    return src === '' ? [] : [{ src, dst }]
  })
}

function partitionGlossaryTerms(args: {
  glossary_entries: ProofreadingRuntimeGlossaryEntry[]
  src_replaced: string
  dst_replaced: string
}): {
  failed_terms: ProofreadingGlossaryTerm[]
  applied_terms: ProofreadingGlossaryTerm[]
} {
  const failed_terms: ProofreadingGlossaryTerm[] = []
  const applied_terms: ProofreadingGlossaryTerm[] = []

  for (const entry of args.glossary_entries) {
    if (!args.src_replaced.includes(entry.src)) {
      continue
    }

    const term = [entry.src, entry.dst] as const
    if (entry.dst !== '' && args.dst_replaced.includes(entry.dst)) {
      applied_terms.push(term)
    } else {
      failed_terms.push(term)
    }
  }

  return {
    failed_terms,
    applied_terms,
  }
}

function hasSimilarityError(args: {
  src_replaced: string
  dst_replaced: string
  sample_regex: RegExp | null
}): boolean {
  const src = stripPreservedSegments(args.src_replaced, args.sample_regex).trim()
  const dst = stripPreservedSegments(args.dst_replaced, args.sample_regex).trim()
  if (src === '' || dst === '') {
    return false
  }

  if (src.includes(dst) || dst.includes(src)) {
    return true
  }

  const left_set = new Set(src)
  const right_set = new Set(dst)
  const union_size = new Set([...left_set, ...right_set]).size
  if (union_size === 0) {
    return false
  }

  let intersection_size = 0
  for (const value of left_set) {
    if (right_set.has(value)) {
      intersection_size += 1
    }
  }

  return intersection_size / union_size > PROOFREADING_SIMILARITY_THRESHOLD
}

function createProofreadingClientItem(args: {
  item: ProofreadingRuntimeItem
  warnings: string[]
  failed_terms: ProofreadingGlossaryTerm[]
  applied_terms: ProofreadingGlossaryTerm[]
}): ProofreadingClientItem {
  return {
    item_id: args.item.item_id,
    file_path: args.item.file_path,
    row_number: args.item.row_number,
    src: args.item.src,
    dst: args.item.dst,
    status: args.item.status,
    warnings: [...args.warnings],
    failed_glossary_terms: args.failed_terms.map((term) => {
      return [term[0], term[1]] as const
    }),
    applied_glossary_terms: args.applied_terms.map((term) => {
      return [term[0], term[1]] as const
    }),
    row_id: build_proofreading_row_id(args.item.item_id),
    compressed_src: compress_proofreading_text(args.item.src),
    compressed_dst: compress_proofreading_text(args.item.dst),
  }
}

function checkProofreadingItem(args: {
  item: ProofreadingRuntimeItem
  glossary_entries: ProofreadingRuntimeGlossaryEntry[]
  quality: ProjectStoreQualityState
  source_language: string
  sample_regex_cache: Map<string, RegExp | null>
}): ProofreadingClientItem {
  const warnings: string[] = []
  const failed_terms: ProofreadingGlossaryTerm[] = []
  const applied_terms: ProofreadingGlossaryTerm[] = []
  const sample_regex_cache_key = `${args.item.text_type}:${args.quality.text_preserve.mode}:${args.quality.text_preserve.revision}`
  let sample_regex = args.sample_regex_cache.get(sample_regex_cache_key)
  if (sample_regex === undefined) {
    sample_regex = createTextPreserveRegex({
      mode: args.quality.text_preserve.mode,
      text_type: args.item.text_type,
      entries: args.quality.text_preserve.entries,
    })
    args.sample_regex_cache.set(sample_regex_cache_key, sample_regex)
  }

  if (
    PROOFREADING_SKIPPED_WARNING_STATUSES.has(args.item.status)
    || args.item.dst === ''
  ) {
    return createProofreadingClientItem({
      item: args.item,
      warnings,
      failed_terms,
      applied_terms,
    })
  }

  const { src_replaced, dst_replaced } = applyQualityReplacements(args.item, args.quality)
  const normalized_dst = stripPreservedSegments(args.item.dst, sample_regex)
  if (
    args.source_language === 'JA'
    && (HIRAGANA_REGEX.test(normalized_dst) || KATAKANA_REGEX.test(normalized_dst))
  ) {
    warnings.push('KANA')
  }

  if (args.source_language === 'KO' && HANGEUL_REGEX.test(normalized_dst)) {
    warnings.push('HANGEUL')
  }

  if (
    collectNonBlankPreservedSegments(src_replaced, sample_regex).join('\u0000')
    !== collectNonBlankPreservedSegments(dst_replaced, sample_regex).join('\u0000')
  ) {
    warnings.push('TEXT_PRESERVE')
  }

  if (
    hasSimilarityError({
      src_replaced,
      dst_replaced,
      sample_regex,
    })
  ) {
    warnings.push('SIMILARITY')
  }

  if (args.glossary_entries.length > 0) {
    const glossary_result = partitionGlossaryTerms({
      glossary_entries: args.glossary_entries,
      src_replaced,
      dst_replaced,
    })
    failed_terms.push(...glossary_result.failed_terms)
    applied_terms.push(...glossary_result.applied_terms)
    if (glossary_result.failed_terms.length > 0) {
      warnings.push('GLOSSARY')
    }
  }

  if (args.item.retry_count >= PROOFREADING_RETRY_THRESHOLD) {
    warnings.push('RETRY_THRESHOLD')
  }

  return createProofreadingClientItem({
    item: args.item,
    warnings,
    failed_terms,
    applied_terms,
  })
}

export function buildProofreadingRuntimeInput(args: {
  state: ProjectStoreState
  settings_snapshot: SettingsSnapshot
}): ProofreadingRuntimeInput {
  const items = Object.values(args.state.items)
    .flatMap((record) => {
      const item = normalizeRuntimeItem(record)
      return item === null ? [] : [item]
    })
    .sort(compareRuntimeItems)

  return {
    project_id: args.state.project.path,
    revision: Number(args.state.proofreading.revision ?? 0),
    total_item_count: Object.keys(args.state.items).length,
    items,
    quality: args.state.quality,
    settings: {
      source_language: args.settings_snapshot.source_language,
    },
  }
}

export function computeProofreadingSnapshot(
  input: ProofreadingRuntimeInput,
): ProofreadingSnapshot {
  const glossary_entries = buildGlossaryEntries(input.quality)
  const sample_regex_cache = new Map<string, RegExp | null>()
  const review_items = input.items.filter((item) => {
    return item.src.trim() !== '' && !PROOFREADING_REVIEW_EXCLUDED_STATUSES.has(item.status)
  })
  const runtime_items = review_items.map((item) => {
    return checkProofreadingItem({
      item,
      glossary_entries,
      quality: input.quality,
      source_language: input.settings.source_language,
      sample_regex_cache,
    })
  })

  const warning_item_count = runtime_items.reduce((count, item) => {
    return count + (item.warnings.length > 0 ? 1 : 0)
  }, 0)

  return {
    revision: input.revision,
    project_id: input.project_id,
    readonly: false,
    summary: {
      ...create_empty_proofreading_summary(),
      total_items: input.total_item_count,
      filtered_items: runtime_items.length,
      warning_items: warning_item_count,
    },
    filters: normalize_proofreading_filter_options(undefined, runtime_items),
    items: runtime_items,
  }
}

function buildGlossaryTermKey(term: ProofreadingGlossaryTerm): string {
  return `${term[0]}→${term[1]}`
}

function itemMatchesGlossaryFilter(
  item: ProofreadingClientItem,
  filters: ProofreadingFilterOptions,
): boolean {
  if (item.failed_glossary_terms.length === 0) {
    return filters.include_without_glossary_miss
  }

  const selected_term_key_set = new Set(
    filters.glossary_terms.map((term) => buildGlossaryTermKey(term)),
  )
  if (selected_term_key_set.size === 0) {
    return false
  }

  return item.failed_glossary_terms.some((term) => {
    return selected_term_key_set.has(buildGlossaryTermKey(term))
  })
}

export function applyProofreadingFilters(args: {
  snapshot: ProofreadingSnapshot
  filters: ProofreadingFilterOptions
}): ProofreadingSnapshot {
  const normalized_filters = normalize_proofreading_filter_options(
    args.filters,
    args.snapshot.items,
  )
  const selected_warning_set = new Set(normalized_filters.warning_types)
  const selected_status_set = new Set(normalized_filters.statuses)
  const selected_file_path_set = new Set(normalized_filters.file_paths)

  const filtered_items = args.snapshot.items
    .filter((item) => {
      const item_warning_codes = item.warnings.length > 0 ? item.warnings : ['NO_WARNING']
      if (!item_warning_codes.some((warning) => selected_warning_set.has(warning))) {
        return false
      }

      if (!selected_status_set.has(item.status)) {
        return false
      }

      if (!selected_file_path_set.has(item.file_path)) {
        return false
      }

      return itemMatchesGlossaryFilter(item, normalized_filters)
    })
    .map((item) => {
      return {
        ...item,
        warnings: [...item.warnings],
        applied_glossary_terms: item.applied_glossary_terms.map((term) => {
          return [term[0], term[1]] as const
        }),
        failed_glossary_terms: item.failed_glossary_terms.map((term) => {
          return [term[0], term[1]] as const
        }),
      }
    })

  const warning_item_count = filtered_items.reduce((count, item) => {
    return count + (item.warnings.length > 0 ? 1 : 0)
  }, 0)

  return {
    revision: args.snapshot.revision,
    project_id: args.snapshot.project_id,
    readonly: args.snapshot.readonly,
    summary: {
      total_items: args.snapshot.summary.total_items,
      filtered_items: filtered_items.length,
      warning_items: warning_item_count,
    },
    filters: clone_proofreading_filter_options(normalized_filters),
    items: filtered_items,
  }
}

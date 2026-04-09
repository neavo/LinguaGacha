export const GLOSSARY_TABLE_ESTIMATED_ROW_HEIGHT = 33
export const GLOSSARY_TABLE_VIRTUAL_OVERSCAN = 8

type BuildGlossaryTableSpacerHeightsParams = {
  viewport_height: number
  total_size: number
  range_start: number
  range_end: number
}

export type GlossaryTableZebraTone = 'odd' | 'even'

export type GlossaryTableSpacerHeights = {
  top_spacer_height: number
  virtual_bottom_spacer_height: number
  viewport_fill_height: number
  bottom_spacer_height: number
}

export type GlossaryTablePlaceholderFill = {
  placeholder_row_heights: number[]
  residual_spacer_height: number
}

function normalize_dimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }

  return value
}

export function build_glossary_table_spacer_heights(
  params: BuildGlossaryTableSpacerHeightsParams,
): GlossaryTableSpacerHeights {
  const normalized_viewport_height = normalize_dimension(params.viewport_height)
  const normalized_total_size = normalize_dimension(params.total_size)
  const normalized_range_start = Math.min(
    normalized_total_size,
    normalize_dimension(params.range_start),
  )
  const normalized_range_end = Math.max(
    normalized_range_start,
    Math.min(normalized_total_size, normalize_dimension(params.range_end)),
  )
  const viewport_fill_height = Math.max(
    0,
    normalized_viewport_height - normalized_total_size,
  )

  return {
    top_spacer_height: normalized_range_start,
    virtual_bottom_spacer_height: Math.max(
      0,
      normalized_total_size - normalized_range_end,
    ),
    viewport_fill_height,
    bottom_spacer_height: Math.max(
      0,
      normalized_total_size - normalized_range_end,
    ) + viewport_fill_height,
  }
}

export function build_glossary_table_placeholder_fill(
  fill_height: number,
  row_height: number,
): GlossaryTablePlaceholderFill {
  const normalized_fill_height = normalize_dimension(fill_height)
  const normalized_row_height = normalize_dimension(row_height)

  if (normalized_fill_height === 0 || normalized_row_height === 0) {
    return {
      placeholder_row_heights: [],
      residual_spacer_height: normalized_fill_height,
    }
  }

  const placeholder_row_count = Math.floor(
    normalized_fill_height / normalized_row_height,
  )
  const residual_spacer_height = normalized_fill_height
    - (placeholder_row_count * normalized_row_height)

  return {
    placeholder_row_heights: Array.from(
      { length: placeholder_row_count },
      () => normalized_row_height,
    ),
    residual_spacer_height,
  }
}

export function resolve_glossary_table_row_zebra(
  row_index: number,
): GlossaryTableZebraTone {
  return Math.abs(row_index) % 2 === 1 ? 'even' : 'odd'
}

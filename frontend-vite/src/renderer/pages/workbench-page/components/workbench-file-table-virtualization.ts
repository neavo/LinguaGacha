export const WORKBENCH_TABLE_ESTIMATED_ROW_HEIGHT = 37
export const WORKBENCH_TABLE_VIRTUAL_OVERSCAN = 8

type BuildWorkbenchTableSpacerHeightsParams = {
  viewport_height: number
  total_size: number
  range_start: number
  range_end: number
}

export type WorkbenchTableZebraTone = 'odd' | 'even'

export type WorkbenchTableSpacerHeights = {
  top_spacer_height: number
  virtual_bottom_spacer_height: number
  viewport_fill_height: number
  bottom_spacer_height: number
}

export type WorkbenchTablePlaceholderFill = {
  placeholder_row_heights: number[]
  residual_spacer_height: number
}

function normalize_dimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }

  return value
}

export function build_workbench_table_spacer_heights(
  params: BuildWorkbenchTableSpacerHeightsParams,
): WorkbenchTableSpacerHeights {
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

  // Why: 短列表也统一走虚拟化时，需要把底部空白折算成一个 spacer，才能保持表格撑满视口。
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

export function build_workbench_table_placeholder_fill(
  fill_height: number,
  row_height: number,
): WorkbenchTablePlaceholderFill {
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

export function resolve_workbench_table_row_zebra(
  row_index: number,
): WorkbenchTableZebraTone {
  return Math.abs(row_index) % 2 === 1 ? 'even' : 'odd'
}

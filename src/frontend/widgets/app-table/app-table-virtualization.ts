// 同时驱动虚拟定位和 CSS 行高，避免滚动估算与占位行分裂。
export const APP_TABLE_DEFAULT_ROW_HEIGHT = 36;
// 控制表格预渲染缓冲，减少快速滚动时的空白闪烁。
export const APP_TABLE_DEFAULT_VIRTUAL_OVERSCAN = 8;

type AppTableZebraTone = "odd" | "even";

// 拆分虚拟列表空白和视口补齐空白，避免底部 spacer 双算。
type AppTableSpacerHeights = {
  top_spacer_height: number;
  virtual_bottom_spacer_height: number;
  viewport_fill_height: number;
  bottom_spacer_height: number;
};

// 把剩余视口高度切成稳定行高和残余 spacer。
type AppTablePlaceholderFill = {
  placeholder_row_heights: number[];
  residual_spacer_height: number;
};

// 把无效布局数值收敛为 0，防止虚拟高度写入 NaN。
function normalize_dimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}

// 统一计算虚拟上下留白和短列表补齐视口的高度。
export function build_app_table_spacer_heights(params: {
  viewport_height: number;
  total_size: number;
  range_start: number;
  range_end: number;
}): AppTableSpacerHeights {
  const normalized_viewport_height = normalize_dimension(params.viewport_height);
  const normalized_total_size = normalize_dimension(params.total_size);
  const normalized_range_start = Math.min(
    normalized_total_size,
    normalize_dimension(params.range_start),
  );
  const normalized_range_end = Math.max(
    normalized_range_start,
    Math.min(normalized_total_size, normalize_dimension(params.range_end)),
  );
  const viewport_fill_height = Math.max(0, normalized_viewport_height - normalized_total_size);

  return {
    top_spacer_height: normalized_range_start,
    virtual_bottom_spacer_height: Math.max(0, normalized_total_size - normalized_range_end),
    viewport_fill_height,
    bottom_spacer_height:
      Math.max(0, normalized_total_size - normalized_range_end) + viewport_fill_height,
  };
}

// 用固定行高补足短列表视口，保留不足一行的残余高度。
export function build_app_table_placeholder_fill(
  fill_height: number,
  row_height: number,
): AppTablePlaceholderFill {
  const normalized_fill_height = normalize_dimension(fill_height);
  const normalized_row_height = normalize_dimension(row_height);

  if (normalized_fill_height === 0 || normalized_row_height === 0) {
    return {
      placeholder_row_heights: [],
      residual_spacer_height: normalized_fill_height,
    };
  }

  const placeholder_row_count = Math.floor(normalized_fill_height / normalized_row_height);
  const residual_spacer_height =
    normalized_fill_height - placeholder_row_count * normalized_row_height;

  return {
    placeholder_row_heights: Array.from(
      { length: placeholder_row_count },
      () => normalized_row_height,
    ),
    residual_spacer_height,
  };
}

// 用源索引稳定决定斑马纹，虚拟窗口切换时颜色不跳变。
export function resolve_app_table_row_zebra(row_index: number): AppTableZebraTone {
  return Math.abs(row_index) % 2 === 1 ? "even" : "odd";
}

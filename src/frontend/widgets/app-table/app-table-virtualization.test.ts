import { describe, expect, it } from "vitest";

import {
  APP_TABLE_DEFAULT_ROW_HEIGHT,
  build_app_table_placeholder_fill,
  build_app_table_spacer_heights,
  resolve_app_table_row_zebra,
} from "@frontend/widgets/app-table/app-table-virtualization";

describe("app-table-virtualization", () => {
  it("短列表会把视口剩余高度拆成占位行和残余 spacer", () => {
    const spacer_heights = build_app_table_spacer_heights({
      viewport_height: 120,
      total_size: 72,
      range_start: 0,
      range_end: 72,
    });
    const placeholder_fill = build_app_table_placeholder_fill(
      spacer_heights.viewport_fill_height,
      APP_TABLE_DEFAULT_ROW_HEIGHT,
    );

    expect(spacer_heights).toEqual({
      top_spacer_height: 0,
      virtual_bottom_spacer_height: 0,
      viewport_fill_height: 48,
      bottom_spacer_height: 48,
    });
    expect(placeholder_fill).toEqual({
      placeholder_row_heights: [36],
      residual_spacer_height: 12,
    });
  });

  it("非法几何值会收敛为空布局", () => {
    expect(
      build_app_table_spacer_heights({
        viewport_height: Number.NaN,
        total_size: -1,
        range_start: 10,
        range_end: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({
      top_spacer_height: 0,
      virtual_bottom_spacer_height: 0,
      viewport_fill_height: 0,
      bottom_spacer_height: 0,
    });
    expect(build_app_table_placeholder_fill(72, 0)).toEqual({
      placeholder_row_heights: [],
      residual_spacer_height: 72,
    });
  });

  it("斑马纹按源索引保持稳定", () => {
    expect(resolve_app_table_row_zebra(0)).toBe("odd");
    expect(resolve_app_table_row_zebra(1)).toBe("even");
    expect(resolve_app_table_row_zebra(-1)).toBe("even");
  });
});

import { describe, expect, it } from "vitest";

import { calculate_media_fit_scale, clamp_media_pan } from "./agent-media-preview-dialog";

describe("媒体预览几何计算", () => {
  it("使用单一居中适应比例且不放大小媒体", () => {
    expect(
      calculate_media_fit_scale({ width: 1000, height: 800 }, { width: 2000, height: 1000 }),
    ).toBe(0.5);
    expect(
      calculate_media_fit_scale({ width: 1000, height: 800 }, { width: 400, height: 300 }),
    ).toBe(1);
  });

  it("按各轴独立限制适应尺寸媒体的平移范围", () => {
    const viewport = { width: 1000, height: 800 };
    const media = { width: 2000, height: 1000 };
    expect(clamp_media_pan({ x: 999, y: 999 }, viewport, media, 0.5, 1)).toEqual({ x: 0, y: 0 });
    expect(clamp_media_pan({ x: 999, y: 999 }, viewport, media, 0.5, 2)).toEqual({
      x: 500,
      y: 100,
    });
    expect(clamp_media_pan({ x: -999, y: -999 }, viewport, media, 0.5, 2)).toEqual({
      x: -500,
      y: -100,
    });
  });
});

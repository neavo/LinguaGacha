import { describe, expect, it } from "vitest";
import { calculate_media_fit_scale, clamp_media_pan } from "./media-geometry";

describe("媒体预览几何计算", () => {
  it.each([1, 1.25, 2])("DPR %s 时位图默认不超过原始物理像素，文档按视口适配", (ratio) => {
    const viewport = { width: 1000, height: 800 };
    const image = { width: 320, height: 180 };
    expect(calculate_media_fit_scale(viewport, image, ratio, "image") * image.width * ratio).toBe(
      320,
    );
    expect(calculate_media_fit_scale(viewport, image, ratio, "document")).toBe(1000 / 320);
    expect(calculate_media_fit_scale({ width: 100, height: 80 }, image, ratio, "image")).toBe(
      100 / 320,
    );
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

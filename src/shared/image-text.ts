import type { ImageTextPage } from "./image-text-schema";
export type { ImageTextPage, ImageTextRegion } from "./image-text-schema";

/** 字号与栅格判定共用规则。调用者只提供正文与已确认区域事实。 */
export const IMAGE_TEXT_RULES = Object.freeze({
  fontFile: "LGBaseFont-Regular.ttf",
  lineHeight: 1.1,
  minimumFontSize: 4,
  minimumStroke: 1,
  maximumStroke: 2.5,
  strokeRatio: 0.1,
  antialiasingAllowance: 1,
  squareDistanceCorrection: Math.SQRT2,
  pageTimeoutMs: 600_000,
  maximumMaterialBytes: 256_000_000,
});

/** 成功时返回原图像素字号，空位图表示区域无法安全排版。 */
export type ImageTextPaint = { regionId: string } & (
  | { png: string; fontSize: number }
  | { png: null }
);

export type ImageTextHostOperation = { kind: "render_image_text_page"; page: ImageTextPage };
export type ImageTextHost = (
  operation: ImageTextHostOperation,
  signal?: AbortSignal,
) => Promise<ImageTextPaint[]>;

/** 排版预留与 Chromium 绘制共用描边宽度。 */
export function image_text_stroke_width(fontSize: number): number {
  const { minimumStroke, maximumStroke, strokeRatio } = IMAGE_TEXT_RULES;
  return Math.min(maximumStroke, Math.max(minimumStroke, fontSize * strokeRatio));
}

/** 按区域背景色的线性亮度比较黑白对比度。 */
export function image_text_color(color: readonly number[]): "black" | "white" {
  const linear = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "black" : "white";
}

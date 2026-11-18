import type { ImageRegion } from "./image-package";

export const IMAGE_TEXT_RULES = Object.freeze({
  fontFile: "LGBaseFont-Regular.ttf",
  lineHeight: 1.1,
  pageTimeoutMs: 600_000,
});

export type ImageTextRegion = Pick<
  ImageRegion,
  "regionId" | "box" | "direction" | "backgroundColor"
> & {
  text: string;
};
export type ImageTextPage = { pageId: string; regions: ImageTextRegion[] };

/** 无法完整写入时返回空位图，写出方据此保留原图。 */
export type ImageTextPaint = { regionId: string; png: string | null };
export type ImageTextHostOperation = { kind: "render_image_text_page"; page: ImageTextPage };
export type ImageTextHost = (
  operation: ImageTextHostOperation,
  signal?: AbortSignal,
) => Promise<ImageTextPaint[]>;

/** 单换行只在相邻词段需要分隔时补空格。段落保留一个空行。 */
export function normalize_image_text(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .split(/\n[\t ]*\n(?:[\t ]*\n)*/u)
    .map((paragraph) =>
      paragraph
        .replace(
          /(?<=[\p{L}\p{M}\p{N}])(?<![\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}])\n(?![\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}])(?=[\p{L}\p{M}\p{N}])/gu,
          " ",
        )
        .replaceAll("\n", ""),
    )
    .join("\n\n");
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

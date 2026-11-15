import {
  IMAGE_TEXT_RULES as RULES,
  image_text_margin,
  type ImageTextPage,
} from "../shared/image-text";

export type TextRectangle = {
  inlineStart: number;
  blockStart: number;
  inlineSize: number;
  blockSize: number;
  lines: number;
};

/** 搜索域是靠近面积重心的中央连续矩形；宽度表来自一次原生排版测量，不承诺旧形状模型的最优解。 */
export function image_text_rectangles(
  region: ImageTextPage["regions"][number],
  distance: Float32Array,
  size: number,
  widths: readonly number[],
): TextRectangle[] {
  const [, , width, height] = region.box;
  const vertical = region.direction === "vertical-rl";
  const inline = vertical ? height : width;
  const block = vertical ? width : height;
  const center = vertical ? width - region.centroid[0] : region.centroid[1];
  const stroke = Math.max(RULES.minimumStroke, size * RULES.strokeRatio);
  const threshold = image_text_margin(size) + stroke / 2 + RULES.squareDistanceCorrection;
  const intervals: [number, number][] = [];
  for (let b = 0; b < block; b++) {
    const safe = (u: number) =>
      distance[vertical ? u * width + width - 1 - b : b * width + u]! >= threshold;
    let lo = Math.floor(inline / 2),
      hi = lo;
    if (safe(lo)) {
      while (lo > 0 && safe(lo - 1)) lo--;
      while (hi < inline && safe(hi)) hi++;
    }
    intervals.push([lo, hi]);
  }
  const rectangles: TextRectangle[] = [];
  for (let lines = 1; lines < widths.length; lines++) {
    const extent = Math.ceil(lines * size * RULES.lineHeight);
    if (extent > block) break;
    const needed = (widths[lines]! * size) / RULES.measurementFontSize;
    if (!Number.isFinite(needed) || needed > inline) continue;
    const start = Math.max(0, Math.min(block - extent, center - extent / 2));
    for (const b of new Set([Math.floor(start), Math.ceil(start)])) {
      let lo = 0,
        hi = inline;
      for (let row = b; row < b + extent; row++) {
        lo = Math.max(lo, intervals[row]![0]);
        hi = Math.min(hi, intervals[row]![1]);
      }
      if (hi - lo >= needed && hi > lo)
        rectangles.push({
          inlineStart: lo,
          blockStart: b,
          inlineSize: hi - lo,
          blockSize: extent,
          lines,
        });
    }
  }
  return rectangles;
}

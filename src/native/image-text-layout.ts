import {
  IMAGE_TEXT_RULES as RULES,
  image_text_margin,
  type ImageTextPage,
} from "../shared/image-text";

type TextBlock = ImageTextPage["regions"][number]["candidates"][number]["blocks"][number];

export type TextSlot = {
  inlineLow: number;
  inlineHigh: number;
  blockStart: number;
  blockSize: number;
};

/** 距离场按行列生成安全区间。竖排 block 坐标从右向左。 */
export function image_text_slot_sets(
  block: TextBlock,
  direction: ImageTextPage["regions"][number]["direction"],
  distance: Float32Array,
  size: number,
): TextSlot[][] {
  const [, , width, height] = block.box;
  const vertical = direction === "vertical-rl";
  const inline = vertical ? height : width;
  const blockSize = vertical ? width : height;
  const inlineCenter = vertical ? block.centroid[1] : block.centroid[0];
  const center = vertical ? width - block.centroid[0] : block.centroid[1];
  const stroke = Math.max(RULES.minimumStroke, size * RULES.strokeRatio);
  const threshold = image_text_margin(size) + stroke / 2 + RULES.squareDistanceCorrection;
  const intervals: [number, number][] = [];
  for (let b = 0; b < blockSize; b++) {
    const safe = (u: number) =>
      distance[vertical ? u * width + width - 1 - b : b * width + u]! >= threshold;
    let lo = Math.max(0, Math.min(inline - 1, Math.floor(inlineCenter)));
    let hi = lo;
    if (safe(lo)) {
      while (lo > 0 && safe(lo - 1)) lo--;
      while (hi < inline && safe(hi)) hi++;
    }
    intervals.push([lo, hi]);
  }
  const pitch = size * RULES.lineHeight;
  const sets: TextSlot[][] = [];
  for (let count = 1; ; count++) {
    const extent = (count - 1) * pitch + size;
    if (extent > blockSize) break;
    const ideal = Math.max(0, Math.min(blockSize - extent, center - extent / 2));
    let best: TextSlot[] | undefined;
    for (const start of new Set([Math.floor(ideal), Math.ceil(ideal)])) {
      const slots: TextSlot[] = [];
      for (let index = 0; index < count; index++) {
        const from = Math.floor(start + index * pitch);
        const to = Math.min(blockSize, Math.ceil(from + size));
        let low = 0;
        let high = inline;
        for (let b = from; b < to; b++) {
          low = Math.max(low, intervals[b]![0]);
          high = Math.min(high, intervals[b]![1]);
        }
        if (high - low < size) {
          slots.length = 0;
          break;
        }
        slots.push({
          inlineLow: low,
          inlineHigh: high,
          blockStart: from,
          blockSize: to - from,
        });
      }
      if (
        slots.length === count &&
        (!best ||
          slots.reduce((sum, slot) => sum + slot.inlineHigh - slot.inlineLow, 0) >
            best.reduce((sum, slot) => sum + slot.inlineHigh - slot.inlineLow, 0))
      )
        best = slots;
    }
    if (best) sets.push(best);
  }
  return sets;
}

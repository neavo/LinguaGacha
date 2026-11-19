import {
  IMAGE_TEXT_RULES as RULES,
  image_text_stroke_width,
  type ImageTextRegion,
} from "../shared/image-text";

type Span = readonly [start: number, end: number];
type Point = readonly [inline: number, block: number];
type TextRectangle = { along: Span; across: Span };

const PADDING_EM = 0.25;

export type TextSlot = {
  inlineLow: number;
  inlineHigh: number;
  blockStart: number;
  anchor: number;
};

/** 按排序方向计算文字凸包的一侧。 */
function hull_chain(points: readonly Point[]): Point[] {
  const chain: Point[] = [];
  for (const point of points) {
    while (chain.length >= 2) {
      const [ax, ay] = chain[chain.length - 2]!;
      const [bx, by] = chain.at(-1)!;
      const [cx, cy] = point;
      if ((bx - ax) * (cy - ay) > (by - ay) * (cx - ax)) break;
      chain.pop();
    }
    chain.push(point);
  }
  return chain;
}

/** 找到扫描行与凸包边的交点。 */
function inline_at([ax, ay]: Point, [bx, by]: Point, block: number): number {
  return ax + ((block - ay) * (bx - ax)) / (by - ay);
}

/** 逐像素行将文字凸包与容器区间相交，气泡的凹口和空洞不计入文字占用。 */
function hull_area(rectangles: readonly TextRectangle[], rows: readonly Span[][]): number {
  const points = rectangles.flatMap(({ along: [x0, x1], across: [y0, y1] }): Point[] => [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ]);
  if (!points.length) return 0;
  points.sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
  const first = points[0]![1];
  const last = points.at(-1)![1];
  const a = hull_chain(points);
  const b = hull_chain(points.reverse()).reverse();
  let area = 0;
  let i = 0;
  let j = 0;
  for (let v = first; v < last; v++) {
    const y = v + 0.5;
    while (a[i + 1]![1] <= y) i++;
    while (b[j + 1]![1] <= y) j++;
    const x0 = inline_at(a[i]!, a[i + 1]!, y);
    const x1 = inline_at(b[j]!, b[j + 1]!, y);
    const low = Math.min(x0, x1);
    const high = Math.max(x0, x1);
    for (const [start, end] of rows[v]!)
      area += Math.max(0, Math.min(end, high) - Math.max(start, low));
  }
  return area;
}

/** 只在掩码内生成安全行带，竖排从右向左。 */
export function image_text_slots(
  region: Pick<ImageTextRegion, "size" | "direction">,
  distance: Float32Array,
) {
  const [width, height] = region.size;
  const vertical = region.direction === "vertical-rl";
  const inline = vertical ? height : width;
  const block = vertical ? width : height;
  const maximumFontSize = Math.min(inline, Math.floor(block / (1 + 2 * PADDING_EM)));
  const at = (u: number, v: number) =>
    distance[vertical ? u * width + width - 1 - v : v * width + u]!;
  let containerArea = 0;
  let weight = 0;
  let x = 0;
  let y = 0;
  // 细尾巴的距离值小，对主体中心的影响自然较小。
  for (let i = 0; i < distance.length; i++) {
    const value = distance[i]!;
    if (value <= 0) continue;
    containerArea++;
    const mass = value ** 2;
    weight += mass;
    x += ((i % width) + 0.5) * mass;
    y += (Math.floor(i / width) + 0.5) * mass;
  }
  const inlineCenter = weight ? (vertical ? y : x) / weight : inline / 2;
  const blockCenter = weight ? (vertical ? width - x / weight : y / weight) : block / 2;

  const spansByMargin = new Map<number, Span[][]>(); // 留边取整，多个字号可以复用同一组区间。
  /** 逐行提取满足留边的连续区间。 */
  function spans(margin: number): Span[][] {
    const cached = spansByMargin.get(margin);
    if (cached) return cached;
    const rows: Span[][] = [];
    for (let v = 0; v < block; v++) {
      const row: Span[] = [];
      for (let u = 0; u < inline;) {
        const start = u;
        while (u < inline && at(u, v) >= margin) u++;
        if (u > start) row.push([start, u]);
        u++;
      }
      rows.push(row);
    }
    spansByMargin.set(margin, rows);
    return rows;
  }

  /** 从可写掩码先扣除字层的像素余量，再留出阅读空间。 */
  function safe_spans(size: number): Span[][] {
    return spans(
      Math.ceil(
        image_text_stroke_width(size) / 2 +
          RULES.antialiasingAllowance +
          RULES.squareDistanceCorrection +
          size * PADDING_EM,
      ),
    );
  }

  /** 取整条行带都能容纳的区间，优先靠近文字的对齐点。 */
  function band(rows: Span[][], size: number, start: number): TextSlot | undefined {
    let low = 0;
    let high = inline;
    for (let v = start; v < start + size; v++) {
      let best: Span | undefined;
      let bestScore = -Infinity;
      for (const [a, b] of rows[v]!) {
        const left = Math.max(a, low);
        const right = Math.min(b, high);
        if (left >= right) continue;
        const score = right - left - 2 * Math.max(0, left - inlineCenter, inlineCenter - right);
        if (score > bestScore) {
          best = [left, right];
          bestScore = score;
        }
      }
      if (!best) return undefined;
      [low, high] = best;
    }
    return { inlineLow: low, inlineHigh: high, blockStart: start, anchor: inlineCenter };
  }

  /** 居中已试尽时，只生成偏移后的位置。 */
  function* stacks(
    size: number,
    search: boolean,
    maximumLines: number,
  ): IterableIterator<TextSlot[]> {
    const rows = safe_spans(size);
    const pitch = size * RULES.lineHeight;
    for (let count = 1; count <= maximumLines; count++) {
      const extent = (count - 1) * pitch + size;
      const limit = Math.floor(block - extent); // 从这个范围取起点，最后一条行带仍在掩码尺寸内。
      if (limit < 0) break;
      const middle = Math.max(0, Math.min(limit, Math.round(blockCenter - extent / 2)));
      const step = Math.max(1, Math.round(size / 3));
      const starts = search ? [] : [middle];
      if (search) {
        for (let delta = step; delta < Math.max(middle, limit - middle); delta += step) {
          if (middle - delta > 0) starts.push(middle - delta);
          if (middle + delta < limit) starts.push(middle + delta);
        }
        if (middle > 0) starts.push(0);
        if (middle < limit) starts.push(limit);
      }
      for (const start of starts) {
        const slots: TextSlot[] = [];
        for (let i = 0; i < count; i++) {
          const slot = band(rows, size, Math.round(start + i * pitch));
          if (!slot) break;
          slots.push(slot);
        }
        if (slots.length === count) yield slots;
      }
    }
  }

  function coverage(rectangles: readonly TextRectangle[]): number {
    // 距离场以像素为单位，掩码内最近的边界像素距离为 1。
    return containerArea ? hull_area(rectangles, spans(1)) / containerArea : 0;
  }

  return { maximumFontSize, coverage, stacks };
}

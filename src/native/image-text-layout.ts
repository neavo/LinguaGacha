import {
  IMAGE_TEXT_RULES as RULES,
  image_text_stroke_width,
  type ImageTextRegion,
} from "../shared/image-text";

type Span = readonly [start: number, end: number];
type Point = readonly [inline: number, block: number];
type TextRectangle = { along: Span; across: Span };

const BUBBLE_PADDING_EM = 0.25;

export type TextSlot = {
  inlineLow: number;
  inlineHigh: number;
  blockStart: number;
  anchor: number;
};

function median(values: number[]): number {
  values.sort((a, b) => a - b); // 取代表性行高，避免个别大字抬高整区字号。
  return values[Math.floor(values.length / 2)]!;
}

function midpoint([start, end]: Span): number {
  return (start + end) / 2; // 行带落到像素格时再取整。
}

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

/** 投影到书写方向，横排按行，竖排从右向左按列。 */
function source_lines(region: ImageTextRegion, width: number): TextRectangle[] {
  const vertical = region.direction === "vertical-rl";
  const projected: TextRectangle[] = region.sourceLines.map((quad) => {
    const along = quad.map(([x, y]) => (vertical ? y : x));
    const across = quad.map(([x, y]) => (vertical ? width - x : y));
    return {
      along: [Math.min(...along), Math.max(...along)],
      across: [Math.min(...across), Math.max(...across)],
    };
  });
  projected.sort((a, b) => midpoint(a.across) - midpoint(b.across));

  const lines: TextRectangle[] = [];
  for (const line of projected) {
    const last = lines.at(-1);
    const [a, b] = line.across;
    // OCR 可能把同一行拆成多个框。重叠半行以上的框共用一个行带。
    if (
      last &&
      Math.min(last.across[1], b) - Math.max(last.across[0], a) >
        Math.min(last.across[1] - last.across[0], b - a) / 2
    ) {
      last.along = [Math.min(last.along[0], line.along[0]), Math.max(last.along[1], line.along[1])];
      last.across = [Math.min(last.across[0], a), Math.max(last.across[1], b)];
    } else lines.push(line);
  }
  return lines;
}

/** 只在区域内部生成安全行带。竖排从右向左，倾斜区域使用 helper 提供的局部坐标。 */
export function image_text_slots(region: ImageTextRegion, distance: Float32Array) {
  const [width, height] = region.alignment?.size ?? [region.box[2], region.box[3]];
  const vertical = region.direction === "vertical-rl";
  const inline = vertical ? height : width;
  const block = vertical ? width : height;
  const isBubble = region.kind === "bubble";
  const lines = isBubble ? [] : source_lines(region, width);
  const maximumFontSize = Math.min(
    inline,
    isBubble ? Math.floor(block / (1 + 2 * BUBBLE_PADDING_EM)) : block,
  );
  const at = (u: number, v: number) =>
    distance[vertical ? u * width + width - 1 - v : v * width + u]!;
  let inlineCenter = inline / 2;
  let blockCenter = block / 2;
  let containerArea = 0;
  if (isBubble) {
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
    if (weight) {
      inlineCenter = vertical ? y / weight : x / weight;
      blockCenter = vertical ? width - x / weight : y / weight;
    }
  }

  const spansByMargin = new Map<number, Span[][]>(); // 留边取整，多个字号可以复用同一组区间。
  /** 将安全像素压缩为连续区间，供同留边的字号复用。 */
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

  /** 留出描边、抗锯齿和旋转余量，气泡额外保留呼吸空间。 */
  function safe_spans(size: number): Span[][] {
    return spans(
      Math.ceil(
        image_text_stroke_width(size) / 2 +
          RULES.antialiasingAllowance +
          RULES.squareDistanceCorrection +
          (region.alignment ? RULES.rotationAllowance : 0) +
          (isBubble ? size * BUBBLE_PADDING_EM : 0),
      ),
    );
  }

  /** 取整条行带都能容纳的区间，优先靠近文字的对齐点。 */
  function band(rows: Span[][], size: number, start: number, anchor: number): TextSlot | undefined {
    if (start < 0 || start + size > block) return undefined;
    let low = 0;
    let high = inline;
    for (let v = start; v < start + size; v++) {
      let best: Span | undefined;
      let bestScore = -Infinity;
      for (const [a, b] of rows[v]!) {
        const left = Math.max(a, low);
        const right = Math.min(b, high);
        if (left >= right) continue;
        const score = right - left - 2 * Math.max(0, left - anchor, anchor - right);
        if (score > bestScore) {
          best = [left, right];
          bestScore = score;
        }
      }
      if (!best) return undefined;
      [low, high] = best;
    }
    return { inlineLow: low, inlineHigh: high, blockStart: start, anchor };
  }

  /** 居中已试尽时，只生成偏移后的位置。 */
  function* bubble(
    size: number,
    search: boolean,
    maximumLines: number,
  ): IterableIterator<TextSlot[]> {
    const rows = safe_spans(size);
    const pitch = size * RULES.lineHeight;
    for (let count = 1; count <= maximumLines; count++) {
      const extent = (count - 1) * pitch + size;
      const limit = Math.floor(block - extent);
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
          const slot = band(rows, size, Math.round(start + i * pitch), inlineCenter);
          if (!slot) break;
          slots.push(slot);
        }
        if (slots.length === count) yield slots;
      }
    }
  }

  /** 每个原行带保留自己的位置和对齐点。 */
  function unframed(size: number): (TextSlot | undefined)[] {
    const rows = safe_spans(size);
    return lines.map((line) =>
      band(rows, size, Math.round(midpoint(line.across) - size / 2), midpoint(line.along)),
    );
  }

  function coverage(rectangles: readonly TextRectangle[]): number {
    // 距离场以像素为单位，掩码内最近的边界像素距离为 1。
    return containerArea ? hull_area(rectangles, spans(1)) / containerArea : 0;
  }

  return {
    maximumFontSize,
    unframedFontSize: lines.length
      ? Math.min(
          maximumFontSize,
          Math.max(
            RULES.minimumFontSize,
            Math.round(
              median(lines.map(({ across: [start, end] }) => end - start)) * RULES.fontSizeScale,
            ),
          ),
        )
      : 0,
    coverage,
    bubble,
    unframed,
  };
}

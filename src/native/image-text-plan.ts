import {
  layoutNextLine,
  prepareWithSegments,
  walkLineRanges,
  type LayoutCursor,
} from "@chenglou/pretext";
import { IMAGE_TEXT_RULES as RULES, type ImageTextRegion } from "../shared/image-text";
import { image_text_slots, type TextSlot } from "./image-text-layout";

const BUBBLE_COVERAGE_TARGET = 0.75;
const BUBBLE_FONT_PROBES = 32;
const BALANCE_SLACK_EM = [0.5, 1, undefined] as const;
const MAX_SHORT_COLUMN = 2;
const ALIGNMENT_TOLERANCE_PX = 1;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

type PreparedText = ReturnType<typeof prepareWithSegments>;
type PlannedLine = {
  text: string;
  slot: TextSlot;
  inlineStart: number;
  width: number;
  paragraphStart: boolean;
};
type PlannedRegion = { fontSize: number; lines: PlannedLine[] };
type Reading = { topGap: number; shortEdges: number };
type BubblePlan = { plan: PlannedRegion; reading: Reading };
const GOOD_READING: Readonly<Reading> = { topGap: 0, shortEdges: 0 };

function slot_capacity(slot: TextSlot): number {
  return slot.inlineHigh - slot.inlineLow;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** 排完整段文字。Pretext 的游标只在同一区域的行列之间移动。 */
function flow_lines(
  prepared: PreparedText,
  slots: readonly (TextSlot | undefined)[],
  fontSize: number,
  balance?: { length: number; slack: number },
): PlannedRegion | undefined {
  const lines: PlannedLine[] = [];
  let cursor: LayoutCursor | undefined;
  let length = balance?.length ?? 0;
  let room = balance
    ? slots.reduce((total, slot) => total + (slot ? slot_capacity(slot) : 0), 0)
    : 0;
  for (const slot of slots) {
    if (!slot) return undefined;
    const previous = lines.at(-1);
    if (previous && previous.slot.blockStart + fontSize > slot.blockStart) return undefined;
    const capacity = slot_capacity(slot);
    const remaining = slots.length - lines.length;
    room -= capacity;
    // 给剩余行带均分文字，同时补足后续较短行带放不下的部分。
    const width =
      balance && remaining > 1
        ? Math.min(capacity, Math.max(length / remaining + balance.slack, length - room))
        : capacity;
    const line = layoutNextLine(prepared, width, cursor);
    if (!line || line.width > width) return undefined;
    const paragraphStart =
      !cursor ||
      (line.start.graphemeIndex === 0 &&
        prepared.kinds[line.start.segmentIndex - 1] === "hard-break");
    if (!paragraphStart && /^[\p{Pe}\p{Pf},.;:!?，。；：！？、]/u.test(line.text.trimStart()))
      return undefined;
    const inlineStart = clamp(
      slot.anchor - line.width / 2,
      slot.inlineLow,
      slot.inlineHigh - line.width,
    );
    lines.push({ text: line.text, slot, inlineStart, width: line.width, paragraphStart });
    length -= line.width;
    cursor = line.end;
    if (layoutNextLine(prepared, Number.MAX_SAFE_INTEGER, cursor) === null)
      return { fontSize, lines };
  }
  return undefined;
}

/** 只数影响列长的字形，数到足以判断短列即可。 */
function column_characters(text: string): number {
  let count = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (/[\p{L}\p{N}\p{S}]/u.test(segment) && ++count === MAX_SHORT_COLUMN * 2) break;
  }
  return count;
}

function is_short_column(characters: number, longest: number): boolean {
  return characters <= MAX_SHORT_COLUMN && characters < longest && 2 * characters <= longest;
}

/** 同段竖排列共用顶部，首尾短列和无法对齐的距离影响方案排序。 */
function align_vertical_paragraphs({ lines, fontSize }: PlannedRegion): Reading {
  const reading: Reading = { topGap: 0, shortEdges: 0 };
  for (let start = 0; start < lines.length;) {
    let end = start + 1;
    while (end < lines.length && !lines[end]!.paragraphStart) end++;
    const paragraph = lines.slice(start, end);
    start = end;
    if (paragraph.length < 2) continue;

    let low = -Infinity;
    let high = Infinity;
    let longestWidth = 0;
    let longestColumn = 0;
    for (const line of paragraph) {
      low = Math.max(low, line.slot.inlineLow);
      high = Math.min(high, line.slot.inlineHigh - line.width);
      longestWidth = Math.max(longestWidth, line.width);
      longestColumn = Math.max(longestColumn, column_characters(line.text));
    }
    // 各列起点的安全范围有交集时共用顶部。交集为空时，把起点拉到最近。
    const preferred = paragraph[0]!.slot.anchor - longestWidth / 2;
    const top = clamp(preferred, Math.min(low, high), Math.max(low, high));
    for (const line of paragraph)
      line.inlineStart = clamp(top, line.slot.inlineLow, line.slot.inlineHigh - line.width);

    reading.topGap = Math.max(reading.topGap, (low - high - ALIGNMENT_TOLERANCE_PX) / fontSize);
    for (const edge of [paragraph[0]!, paragraph.at(-1)!])
      if (is_short_column(column_characters(edge.text), longestColumn)) reading.shortEdges++;
  }
  return reading;
}

/** 优先对齐顶部，其次减少首尾短列。 */
function compare_reading(a: Reading, b: Reading): number {
  return (
    Number(a.topGap > 0) - Number(b.topGap > 0) ||
    a.shortEdges - b.shortEdges ||
    a.topGap - b.topGap
  );
}

/** 先试均衡断行，必要时放宽列宽。 */
function flow_bubble(
  prepared: PreparedText,
  stack: readonly TextSlot[],
  fontSize: number,
  length: number,
  vertical: boolean,
): BubblePlan | undefined {
  let best: BubblePlan | undefined;
  for (const em of stack.length > 1 ? BALANCE_SLACK_EM : [undefined]) {
    const balance = em === undefined ? undefined : { length, slack: em * fontSize };
    const plan = flow_lines(prepared, stack, fontSize, balance);
    if (plan?.lines.length !== stack.length) continue;
    const reading = vertical ? align_vertical_paragraphs(plan) : GOOD_READING;
    if (compare_reading(reading, GOOD_READING) === 0) return { plan, reading };
    if (!best || compare_reading(reading, best.reading) < 0) best = { plan, reading };
  }
  return best;
}

/** 在可读方案中选取最接近目标占比的字号和位置。 */
function plan_bubble(
  slots: ReturnType<typeof image_text_slots>,
  prepare: (size: number) => PreparedText,
  maximumLines: number,
  vertical: boolean,
): PlannedRegion | undefined {
  const minimum = RULES.minimumFontSize;
  const maximum = slots.maximumFontSize;
  const best: { candidate?: BubblePlan & { distance: number } } = {};
  for (const search of [false, true]) {
    const tried = new Set<number>();
    const try_size = (size: number) => {
      if (size < minimum || size > maximum || tried.has(size)) return;
      tried.add(size);
      const text = prepare(size);
      let length = 0;
      walkLineRanges(text, Number.MAX_SAFE_INTEGER, (line) => {
        length += line.width;
      });
      for (const stack of slots.bubble(size, search, maximumLines)) {
        const candidate = flow_bubble(text, stack, size, length, vertical);
        if (!candidate) continue;
        const current = best.candidate;
        const reading = current ? compare_reading(candidate.reading, current.reading) : -1;
        if (reading > 0) continue;
        const coverage = slots.coverage(
          candidate.plan.lines
            .filter((line) => line.width > 0 && line.text.trim())
            .map((line) => ({
              along: [line.inlineStart, line.inlineStart + line.width],
              across: [line.slot.blockStart, line.slot.blockStart + size],
            })),
        );
        const distance = Math.abs(coverage - BUBBLE_COVERAGE_TARGET);
        if (
          !current ||
          reading < 0 ||
          distance < current.distance ||
          (distance === current.distance && size < current.plan.fontSize)
        ) {
          best.candidate = { ...candidate, distance };
        }
      }
    };

    // shortcut: 大气泡先取样再细化，发现漏选可见字号时再扩大搜索。
    let step = Math.max(1, Math.ceil((maximum - minimum) / BUBBLE_FONT_PROBES));
    for (let size = minimum; size <= maximum; size += step) try_size(size);
    try_size(maximum);
    while (best.candidate && step > 1) {
      const size = best.candidate.plan.fontSize;
      step = Math.ceil(step / 2);
      try_size(size - step);
      try_size(size + step);
    }
    if (best.candidate && compare_reading(best.candidate.reading, GOOD_READING) === 0) break;
  }
  return best.candidate?.plan;
}

/** 气泡按容器占比选版，无框文字优先使用原行带。 */
export function plan_image_text(
  region: ImageTextRegion,
  distance: Float32Array,
): PlannedRegion | undefined {
  const slots = image_text_slots(region, distance);
  const prepared = new Map<number, PreparedText>(); // 同字号的断点和测量结果跨候选位置复用。
  const prepare = (fontSize: number) => {
    let value = prepared.get(fontSize);
    if (!value) {
      value = prepareWithSegments(region.text, fontSize + "px ImageText", {
        whiteSpace: "pre-wrap",
      });
      prepared.set(fontSize, value);
    }
    return value;
  };

  const maximumLines = Array.from(region.text).length;
  if (region.kind === "bubble")
    return plan_bubble(slots, prepare, maximumLines, region.direction === "vertical-rl");

  for (let size = slots.unframedFontSize; size >= RULES.minimumFontSize; size--) {
    const rows = slots.unframed(size);
    let best: PlannedRegion | undefined;
    let centerOffset = Infinity;
    for (let start = 0; start < rows.length; start++) {
      const planned = flow_lines(prepare(size), rows.slice(start), size);
      if (!planned) continue;
      const offset = Math.abs(2 * start + planned.lines.length - rows.length);
      if (offset < centerOffset) {
        best = planned;
        centerOffset = offset;
      }
    }
    if (best) return best;
  }

  for (const search of [false, true]) {
    for (let size = slots.unframedFontSize; size >= RULES.minimumFontSize; size--) {
      for (const stack of slots.bubble(size, search, maximumLines)) {
        const planned = flow_lines(prepare(size), stack, size);
        if (planned?.lines.length === stack.length) return planned;
      }
    }
  }
  return undefined;
}

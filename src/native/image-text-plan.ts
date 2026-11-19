import {
  layoutNextLine,
  layoutNextLineRange,
  prepareWithSegments,
  walkLineRanges,
  type LayoutCursor,
} from "@chenglou/pretext";
import { IMAGE_TEXT_RULES as RULES, type ImageTextRegion } from "../shared/image-text";
import { image_text_slots, type TextSlot } from "./image-text-layout";

const COVERAGE_TARGET = 0.75;
const FONT_PROBES = 32;
const BALANCE_SLACK_EM = [0.5, 1, undefined] as const;
const MAX_SHORT_COLUMN = 2;
const ALIGNMENT_TOLERANCE_PX = 1;
const QUESTION_EXCLAMATION_RUN = /[?!？！⁇⁈⁉‼]+/gu;
const COMBINED_MARK_CELL = "！";
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
type LinePart = { text: string; combined?: true };
type PlacedText = {
  fontSize: number;
  lines: (Pick<PlannedLine, "slot" | "inlineStart"> & { parts: LinePart[] })[];
};
type Reading = { topGap: number; shortEdges: number };
type Candidate = { plan: PlannedRegion; reading: Reading };
const GOOD_READING: Readonly<Reading> = { topGap: 0, shortEdges: 0 };

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** 尝试恰好填完这一组行带。由 Pretext 区分硬换行与软换行。 */
function flow_lines(
  prepared: PreparedText,
  slots: readonly TextSlot[],
  fontSize: number,
  balance?: { length: number; slack: number },
): PlannedRegion | undefined {
  const lines: PlannedLine[] = [];
  let cursor: LayoutCursor | undefined;
  let length = balance?.length ?? 0;
  let room = balance
    ? slots.reduce((total, slot) => total + (slot.inlineHigh - slot.inlineLow), 0)
    : 0;
  for (const slot of slots) {
    const capacity = slot.inlineHigh - slot.inlineLow;
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
    // 自动断行避开行首闭合标点。显式换行保留 Agent 的选择。
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
  }
  // 最后一条行带用完后，再判定是否还有可排内容。
  return layoutNextLineRange(prepared, Number.MAX_SAFE_INTEGER, cursor) === null
    ? { fontSize, lines }
    : undefined;
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
function flow_stack(
  prepared: PreparedText,
  stack: readonly TextSlot[],
  fontSize: number,
  length: number,
  vertical: boolean,
): Candidate | undefined {
  let best: Candidate | undefined;
  for (const em of stack.length > 1 ? BALANCE_SLACK_EM : [undefined]) {
    const balance = em === undefined ? undefined : { length, slack: em * fontSize };
    const plan = flow_lines(prepared, stack, fontSize, balance);
    if (!plan) continue;
    const reading = vertical ? align_vertical_paragraphs(plan) : GOOD_READING;
    if (compare_reading(reading, GOOD_READING) === 0) return { plan, reading };
    if (!best || compare_reading(reading, best.reading) < 0) best = { plan, reading };
  }
  return best;
}

/** 在可读方案中选取最接近目标占比的字号和位置。 */
export function plan_image_text(
  region: ImageTextRegion,
  distance: Float32Array,
): PlacedText | undefined {
  const slots = image_text_slots(region, distance);
  const minimum = region.fontSize ?? RULES.minimumFontSize;
  const maximum = region.fontSize ?? slots.maximumFontSize; // 固定字号只试一个值。
  if (minimum > slots.maximumFontSize) return undefined;
  const vertical = region.direction === "vertical-rl";
  const marks: string[] = [];
  // 全角叹号让纵中横组按一个字宽参与 Pretext 测量，并沿用闭合标点的断行规则。
  const layoutText = vertical
    ? region.text.replace(QUESTION_EXCLAMATION_RUN, (mark) => {
        marks.push(mark);
        return COMBINED_MARK_CELL;
      })
    : region.text;
  const maximumLines = layoutText.length;
  const prepared = new Map<number, { text: PreparedText; length: number }>(); // 偏移搜索复用测量。
  const best: { candidate?: Candidate & { distance: number } } = {};
  for (const search of [false, true]) {
    const tried = new Set<number>();
    const try_size = (size: number) => {
      if (size < minimum || size > maximum || tried.has(size)) return;
      tried.add(size);
      let measurement = prepared.get(size);
      if (!measurement) {
        // 已保存的换行是硬断点，额外的软换行由当前行带宽度决定。
        const text = prepareWithSegments(layoutText, size + "px ImageText", {
          whiteSpace: "pre-wrap",
        });
        let length = 0;
        walkLineRanges(text, Number.MAX_SAFE_INTEGER, (line) => {
          length += line.width;
        });
        measurement = { text, length };
        prepared.set(size, measurement);
      }
      for (const stack of slots.stacks(size, search, maximumLines)) {
        const candidate = flow_stack(measurement.text, stack, size, measurement.length, vertical);
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
        const distance = Math.abs(coverage - COVERAGE_TARGET);
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
    let step = Math.max(1, Math.ceil((maximum - minimum) / FONT_PROBES));
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
  const plan = best.candidate?.plan;
  if (!plan) return undefined;
  let markIndex = 0;
  return {
    fontSize: plan.fontSize,
    lines: plan.lines.map(({ text, slot, inlineStart }) => ({
      slot,
      inlineStart,
      // 按阅读顺序取回原标点，每个占位符对应一个待绘制的纵中横组。
      parts: marks.length
        ? text
            .split(COMBINED_MARK_CELL)
            .flatMap<LinePart>((plain, index) =>
              index === 0
                ? [{ text: plain }]
                : [{ text: marks[markIndex++]!, combined: true }, { text: plain }],
            )
        : [{ text }],
    })),
  };
}

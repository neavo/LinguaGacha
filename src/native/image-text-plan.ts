import { prepareWithSegments, type PreparedTextWithSegments } from "@chenglou/pretext";
import { IMAGE_TEXT_RULES as RULES, type ImageTextRegion } from "../shared/image-text";
import { image_text_slots, type TextSlot } from "./image-text-layout";

const COVERAGE_TARGET = 0.5; // 椭圆内接文字块自然占比约 50%，避免贴边方形气泡被撑大一号。
const FONT_PROBES = 32; // 大气泡字号粗采样份数，后续二分细化到 1px。
const ALIGNMENT_TOLERANCE_PX = 1; // 允许 1px 舍入误差仍视为严格对齐。
const NATURAL_BALANCE_SLACK_EM = 1.1; // 汉字不可拆半，容忍 1 个字宽的自然取整余数与微小字距。
const QUESTION_EXCLAMATION_RUN = /[?!？！⁇⁈⁉‼]{1,3}/gu; // 竖排问叹号纵中横，每组最多合 3 个占一格。
const COMBINED_MARK_CELL = "！"; // 纵中横占位符，按全角一格参与测量与禁则。
// 字体 GSUB vert 表缺失常规中文标点替换，竖排时直接映射到同字体原生全角竖排字形。
const VERTICAL_PUNCTUATION: Readonly<Record<string, string>> = {
  "…": "︙",
  "⋯": "︙",
  "—": "︱",
  "「": "﹁",
  "」": "﹂",
  "『": "﹃",
  "』": "﹄",
  "“": "﹁",
  "”": "﹂",
  "（": "︵",
  "）": "︶",
  "【": "︻",
  "】": "︼",
  "《": "︽",
  "》": "︾",
  "〈": "︿",
  "〉": "﹀",
  "〔": "︹",
  "〕": "︺",
  "｛": "︷",
  "｝": "︸",
  "［": "﹇",
  "］": "﹈",
  "、": "︑",
  "。": "︒",
  "，": "︐",
};
const VERTICAL_PUNCTUATION_PATTERN = new RegExp(
  `[${Object.keys(VERTICAL_PUNCTUATION).join("")}]`,
  "gu",
); // 与映射表同源，避免增删漏改。
// 行首禁则：闭合括号/引号、常规句读、省略号、破折号、波浪号、长音符与中点（含竖排呈现与纵中横占位符）。
const NO_LINE_START = /^[\p{Pe}\p{Pf},.;:!?，。；：！？、︐︑︒…⋯︙—―–︱～〜ー·・]/u;
const NO_LINE_END = /[\p{Ps}\p{Pi}]$/u; // 行尾禁则：开放括号/引号。
const WORD_CHARACTER = /[\p{L}\p{N}]/u; // 实质文字字符，排除标点与符号（\p{S}）。
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

type Atom = {
  text: string;
  width: number;
  trailingText: string; // 仅同行内保留的可折叠空格，软换行行尾不占宽。
  trailingWidth: number;
  words: number; // 本原子含有的实质文字字符数。
  paragraph: number; // 同组内的显式段落序号，DP 禁止单行跨段。
};

type TextBlock = {
  atoms: Atom[];
  prefixWidth: number[]; // 含 trailingWidth 的前缀和，O(1) 求任意行宽。
  prefixWords: number[]; // 实质文字数前缀和，O(1) 判定短列/纯符号列。
  totalWidth: number; // 组内各显式段落净宽之和。
  minLines: number; // 组内显式段落数，即最少所需行带数。
};

type TextEntry = TextBlock | null; // null 表示显式空行，固定占一条空白行带。

type PlannedLine = {
  text: string;
  slot: TextSlot;
  inlineStart: number;
  width: number;
};

type LinePart = { text: string; combined?: true };
type PlacedText = {
  fontSize: number;
  lines: (Pick<PlannedLine, "slot" | "inlineStart"> & { parts: LinePart[] })[];
};

type Reading = {
  topGap: number; // 竖排同组无法严格顶对齐时的最大偏差（单位 em）。
  badLines: number; // 多行/列组中纯符号、单字符、单字符+符号的总数。
  excessRatio: number; // 超出自然取整余数的极差占最长行比例。
};

type BlockPlan = {
  lines: PlannedLine[];
  reading: Reading;
  variance: number; // 组内行宽方差和，用于空行分组打平时择优。
};

type SplitResult = {
  lines: { text: string; width: number }[];
  badLines: number;
  variance: number;
};

const ZERO_READING: Readonly<Reading> = { topGap: 0, badLines: 0, excessRatio: 0 };

/** 将数值限制在 [low, high] 闭区间内。 */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** 按字素统计实质文字字符数（字母、汉字与数字）。 */
function count_words(text: string): number {
  let count = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (WORD_CHARACTER.test(segment)) count++;
  }
  return count;
}

/** 由同组扁平原子构建前缀和与净总宽，供 DP O(1) 查表。 */
function build_block(atoms: Atom[], minLines: number): TextBlock {
  const prefixWidth = [0];
  const prefixWords = [0];
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]!;
    prefixWidth.push(prefixWidth[i]! + atom.width + atom.trailingWidth);
    prefixWords.push(prefixWords[i]! + atom.words);
  }
  return { atoms, prefixWidth, prefixWords, totalWidth: prefixWidth[atoms.length]!, minLines };
}

/** 计算区间 [start, end) 组成单行时的净宽（不含末原子尾随折叠空格）。 */
function line_width(block: TextBlock, start: number, end: number): number {
  return block.prefixWidth[end]! - block.prefixWidth[start]! - block.atoms[end - 1]!.trailingWidth;
}

/** 拼接区间 [start, end) 对应的行文本，省略末原子尾随折叠空格。 */
function line_text(block: TextBlock, start: number, end: number): string {
  let text = "";
  for (let i = start; i < end; i++) {
    const atom = block.atoms[i]!;
    text += atom.text;
    if (i + 1 < end) text += atom.trailingText;
  }
  return text;
}

/** 将 Pretext 测量片段按硬换行分段、按空行划组，并在段内完成避头尾禁则粘连。 */
function parse_text_entries(prepared: PreparedTextWithSegments): TextEntry[] {
  const entries: TextEntry[] = [];
  let blockAtoms: Atom[] = [];
  let paragraphId = 0; // 当前非空组内的显式段落计数。
  let paragraphStart = 0; // 当前显式段落在 blockAtoms 中的起始下标。
  let pendingText = ""; // 行首缩进或行尾禁则开括号，等待粘连到下一个可见原子。
  let pendingWidth = 0;
  let pendingWords = 0;
  let hasContent = false;

  const flush_pending = () => {
    if (!pendingText) return;
    blockAtoms.push({
      text: pendingText,
      width: pendingWidth,
      trailingText: "",
      trailingWidth: 0,
      words: pendingWords,
      paragraph: paragraphId,
    });
    pendingText = "";
    pendingWidth = 0;
    pendingWords = 0;
  };

  const flush_block = () => {
    if (!blockAtoms.length) return;
    entries.push(build_block(blockAtoms, paragraphId));
    blockAtoms = [];
    paragraphId = 0;
    paragraphStart = 0;
  };

  const finish_paragraph = () => {
    if (!hasContent) {
      // 纯空白或空行拆开前后文本组，并占用一条显式空白行带。
      pendingText = "";
      pendingWidth = 0;
      pendingWords = 0;
      flush_block();
      entries.push(null);
      return;
    }
    flush_pending();
    // 显式换行前的折叠尾空格不计入段宽，也不会并入下一段。
    const last = blockAtoms.at(-1)!;
    last.trailingText = "";
    last.trailingWidth = 0;
    paragraphId++;
    paragraphStart = blockAtoms.length;
    hasContent = false;
  };

  for (let i = 0; i < prepared.segments.length; i++) {
    const segment = prepared.segments[i]!;
    const kind = prepared.kinds[i]!;
    const width = prepared.widths[i]!;
    if (kind === "hard-break") {
      finish_paragraph();
      continue;
    }
    if (kind === "zero-width-break" || kind === "soft-hyphen" || kind === "control") continue; // 忽略不可见断行辅助片段。

    // 仅普通西文空格在软换行断点处折叠；全角空格与行首显式缩进保持为可见占位。
    const collapsibleSpace =
      (kind === "space" || kind === "preserved-space") && /^[ \t]+$/u.test(segment);
    if (collapsibleSpace) {
      if (pendingText || blockAtoms.length === paragraphStart) {
        pendingText += segment;
        pendingWidth += width;
      } else {
        const last = blockAtoms.at(-1)!;
        last.trailingText += segment;
        last.trailingWidth += width;
      }
      continue;
    }

    hasContent = true;
    const words = count_words(segment);
    if (NO_LINE_START.test(segment) && !pendingText && blockAtoms.length > paragraphStart) {
      const last = blockAtoms.at(-1)!;
      last.text += last.trailingText + segment;
      last.width += last.trailingWidth + width;
      last.trailingText = "";
      last.trailingWidth = 0;
      last.words += words;
      continue;
    }

    if (NO_LINE_END.test(segment)) {
      pendingText += segment;
      pendingWidth += width;
      pendingWords += words;
      continue;
    }

    blockAtoms.push({
      text: pendingText + segment,
      width: pendingWidth + width,
      trailingText: "",
      trailingWidth: 0,
      words: pendingWords + words,
      paragraph: paragraphId,
    });
    pendingText = "";
    pendingWidth = 0;
    pendingWords = 0;
  }
  finish_paragraph();
  flush_block();
  return entries;
}

/** 用单层 DP 将整组原子恰好切入指定行带：不跨显式换行、优先规避短列/纯符号列、其次最小化行宽方差。 */
function split_block(
  block: TextBlock,
  capacities: readonly number[],
  groupMultiLine: boolean,
): SplitResult | undefined {
  const count = capacities.length;
  const n = block.atoms.length;
  if (count < block.minLines || n < count) return undefined;
  const targetWidth = block.totalWidth / count;

  if (count === 1) {
    if (block.totalWidth > capacities[0]!) return undefined;
    const words = block.prefixWords[n]!;
    const diff = block.totalWidth - targetWidth;
    return {
      lines: [{ text: line_text(block, 0, n), width: block.totalWidth }],
      badLines: groupMultiLine && words <= 1 ? 1 : 0,
      variance: diff * diff,
    };
  }

  const stride = n + 1;
  const bestBad = new Float64Array((count + 1) * stride).fill(Infinity); // Infinity 表示不可达状态。
  const bestCost = new Float64Array((count + 1) * stride).fill(Infinity);
  const prev = new Int32Array((count + 1) * stride).fill(-1);
  bestBad[0] = 0;
  bestCost[0] = 0;

  for (let k = 1; k <= count; k++) {
    const capacity = capacities[k - 1]!;
    const maxEnd = n - (count - k);
    for (let end = k; end <= maxEnd; end++) {
      const endParagraph = block.atoms[end - 1]!.paragraph;
      let chosenBad = Infinity;
      let chosenCost = Infinity;
      let chosenStart = -1;
      for (let start = end - 1; start >= k - 1; start--) {
        // 单行不得跨越显式单换行边界，确保每个显式段落都完整落入独立行带区间。
        if (block.atoms[start]!.paragraph !== endParagraph) break;
        const width = line_width(block, start, end);
        if (width > capacity) break;
        const previousIndex = (k - 1) * stride + start;
        const previousBad = bestBad[previousIndex]!;
        if (previousBad === Infinity) continue;
        const words = block.prefixWords[end]! - block.prefixWords[start]!;
        const bad = previousBad + (groupMultiLine && words <= 1 ? 1 : 0);
        const diff = width - targetWidth;
        const cost = bestCost[previousIndex]! + diff * diff;
        if (bad < chosenBad || (bad === chosenBad && cost < chosenCost)) {
          chosenBad = bad;
          chosenCost = cost;
          chosenStart = start;
        }
      }
      if (chosenStart !== -1) {
        const index = k * stride + end;
        bestBad[index] = chosenBad;
        bestCost[index] = chosenCost;
        prev[index] = chosenStart;
      }
    }
  }

  const finalIndex = count * stride + n;
  if (prev[finalIndex] === -1) return undefined;

  const lines: { text: string; width: number }[] = [];
  let cursor = n;
  for (let k = count; k >= 1; k--) {
    const start = prev[k * stride + cursor]!;
    lines.push({ text: line_text(block, start, cursor), width: line_width(block, start, cursor) });
    cursor = start;
  }
  lines.reverse();
  return { lines, badLines: bestBad[finalIndex]!, variance: bestCost[finalIndex]! };
}

/** 计算多行/列组超出 1em 自然取整余数后的相对极差，用于衡量长度平衡度。 */
function measure_excess_ratio(lines: readonly { width: number }[], fontSize: number): number {
  if (lines.length < 2) return 0;
  let minWidth = Infinity;
  let maxWidth = 0;
  for (const line of lines) {
    minWidth = Math.min(minWidth, line.width);
    maxWidth = Math.max(maxWidth, line.width);
  }
  const excessEm = Math.max(0, (maxWidth - minWidth) / fontSize - NATURAL_BALANCE_SLACK_EM);
  return excessEm / Math.max(1, maxWidth / fontSize);
}

/** 竖排同组优先以共享上缘下界为容量约束求严格顶对齐方案，无法交集对齐时降级到最小偏差。 */
function layout_block(
  block: TextBlock,
  slots: readonly TextSlot[],
  fontSize: number,
  vertical: boolean,
): BlockPlan | undefined {
  const count = slots.length;
  const multiLine = count > 1;
  const alignTop = vertical && multiLine;

  let split: SplitResult | undefined;
  if (alignTop) {
    let sharedLow = -Infinity;
    for (const slot of slots) sharedLow = Math.max(sharedLow, slot.inlineLow);
    const alignedCaps = slots.map((slot) => slot.inlineHigh - sharedLow);
    if (alignedCaps.every((capacity) => capacity > 0)) {
      split = split_block(block, alignedCaps, true);
    }
  }
  if (!split) {
    split = split_block(
      block,
      slots.map((slot) => slot.inlineHigh - slot.inlineLow),
      multiLine,
    );
  }
  if (!split) return undefined;

  let topGap = 0;
  let lines: PlannedLine[];
  if (alignTop) {
    let low = -Infinity;
    let high = Infinity;
    let longestWidth = 0;
    for (let i = 0; i < count; i++) {
      const slot = slots[i]!;
      const width = split.lines[i]!.width;
      low = Math.max(low, slot.inlineLow);
      high = Math.min(high, slot.inlineHigh - width);
      longestWidth = Math.max(longestWidth, width);
    }
    // 交集非空时所有列严格共用 top；为空时各自贴向交集最近点并记录偏差。
    const top = clamp(
      slots[0]!.anchor - longestWidth / 2,
      Math.min(low, high),
      Math.max(low, high),
    );
    topGap = Math.max(0, (low - high - ALIGNMENT_TOLERANCE_PX) / fontSize);
    lines = split.lines.map((line, index) => {
      const slot = slots[index]!;
      return {
        text: line.text,
        slot,
        inlineStart: clamp(top, slot.inlineLow, slot.inlineHigh - line.width),
        width: line.width,
      };
    });
  } else {
    lines = split.lines.map((line, index) => {
      const slot = slots[index]!;
      return {
        text: line.text,
        slot,
        inlineStart: clamp(
          slot.anchor - line.width / 2,
          slot.inlineLow,
          slot.inlineHigh - line.width,
        ),
        width: line.width,
      };
    });
  }

  return {
    lines,
    reading: {
      topGap,
      badLines: split.badLines,
      excessRatio: measure_excess_ratio(split.lines, fontSize),
    },
    variance: split.variance,
  };
}

/** 严格落实优先级：1（上缘对齐） > 2（规避纯符号/单字符/单字符+符号）。 */
function compare_reading(a: Reading, b: Reading): number {
  return (
    Number(a.topGap > 0) - Number(b.topGap > 0) || a.topGap - b.topGap || a.badLines - b.badLines
  );
}

/** 合并由空行隔开的多组阅读指标。 */
function merge_readings(a: Reading, b: Reading): Reading {
  return {
    topGap: Math.max(a.topGap, b.topGap),
    badLines: a.badLines + b.badLines,
    excessRatio: Math.max(a.excessRatio, b.excessRatio),
  };
}

/** 将包含可选空行的全部文本组分配到当前行带栈上，求组间最优排布。 */
function layout_stack(
  entries: readonly TextEntry[],
  slots: readonly TextSlot[],
  fontSize: number,
  vertical: boolean,
): BlockPlan | undefined {
  if (entries.length === 1) {
    const only = entries[0];
    if (only) return layout_block(only, slots, fontSize, vertical);
  }

  const entryCount = entries.length;
  const slotCount = slots.length;
  const minAfter = new Int32Array(entryCount + 1); // 后缀最少所需行带数，用于剪枝分配边界。
  for (let i = entryCount - 1; i >= 0; i--) {
    const entry = entries[i];
    minAfter[i] = minAfter[i + 1]! + (entry ? entry.minLines : 1);
  }
  if (slotCount < minAfter[0]!) return undefined;

  const dp: (BlockPlan | undefined)[][] = Array.from({ length: entryCount + 1 }, () =>
    Array.from({ length: slotCount + 1 }, () => undefined),
  );
  dp[0]![0] = { lines: [], reading: ZERO_READING, variance: 0 };

  for (let e = 1; e <= entryCount; e++) {
    const entry = entries[e - 1]!;
    const minBefore = minAfter[0]! - minAfter[e - 1]!;
    const maxEnd = slotCount - minAfter[e]!;
    if (entry === null) {
      for (let end = minBefore + 1; end <= maxEnd; end++) {
        const prefix = dp[e - 1]![end - 1];
        if (!prefix) continue;
        const slot = slots[end - 1]!;
        dp[e]![end] = {
          lines: [...prefix.lines, { text: "", slot, inlineStart: slot.inlineLow, width: 0 }],
          reading: prefix.reading,
          variance: prefix.variance,
        };
      }
      continue;
    }

    for (let end = minBefore + entry.minLines; end <= maxEnd; end++) {
      let best: BlockPlan | undefined;
      for (let start = minBefore; start <= end - entry.minLines; start++) {
        const prefix = dp[e - 1]![start];
        if (!prefix) continue;
        const part = layout_block(entry, slots.slice(start, end), fontSize, vertical);
        if (!part) continue;
        const reading = merge_readings(prefix.reading, part.reading);
        const variance = prefix.variance + part.variance;
        const order = best
          ? compare_reading(reading, best.reading) ||
            reading.excessRatio - best.reading.excessRatio ||
            variance - best.variance
          : -1;
        if (order < 0) {
          best = { lines: [...prefix.lines, ...part.lines], reading, variance };
        }
      }
      dp[e]![end] = best;
    }
  }
  return dp[entryCount]![slotCount];
}

/** 在可读方案中按 1（顶对齐） > 2（避短列/纯符号） > 3（列长平衡与占比）选取字号和位置。 */
export function plan_image_text(
  region: ImageTextRegion,
  distance: Float32Array,
): PlacedText | undefined {
  const slots = image_text_slots(region, distance);
  const minimum = region.fontSize ?? RULES.minimumFontSize;
  const maximum = region.fontSize ?? slots.maximumFontSize; // 固定字号只试一个值。
  if (minimum > slots.maximumFontSize) return undefined;
  const vertical = region.direction === "vertical-rl";
  const marks: string[] = []; // 按阅读顺序缓存被替换的问叹号纵中横原串。
  // 竖排下先映射原生竖排标点，再用全角叹号占位，使纵中横组按一个字格参与测量与禁则。
  const layoutText = vertical
    ? region.text
        .replace(VERTICAL_PUNCTUATION_PATTERN, (char) => VERTICAL_PUNCTUATION[char]!)
        .replace(QUESTION_EXCLAMATION_RUN, (mark) => {
          marks.push(mark);
          return COMBINED_MARK_CELL;
        })
    : region.text;
  const maximumLines = layoutText.length;
  const parsed = new Map<number, TextEntry[]>(); // 偏移搜索复用同字号测量与原子切分。
  let best: { fontSize: number; lines: PlannedLine[]; reading: Reading; score: number } | undefined;

  for (const search of [false, true]) {
    const tried = new Set<number>();
    const try_size = (size: number) => {
      if (size < minimum || size > maximum || tried.has(size)) return;
      tried.add(size);
      let entries = parsed.get(size);
      if (!entries) {
        // 已保存的换行是硬断点，额外的软换行由当前行带宽度与 DP 均衡决定。
        const prepared = prepareWithSegments(layoutText, size + "px ImageText", {
          whiteSpace: "pre-wrap",
        });
        entries = parse_text_entries(prepared);
        parsed.set(size, entries);
      }
      for (const stack of slots.stacks(size, search, maximumLines)) {
        const planned = layout_stack(entries, stack, size, vertical);
        if (!planned) continue;
        const readingOrder = best ? compare_reading(planned.reading, best.reading) : -1;
        if (readingOrder > 0) continue;
        const coverage = slots.coverage(
          planned.lines
            .filter((line) => line.width > 0 && line.text.trim())
            .map((line) => ({
              along: [line.inlineStart, line.inlineStart + line.width],
              across: [line.slot.blockStart, line.slot.blockStart + size],
            })),
        );
        const score = Math.abs(coverage - COVERAGE_TARGET) + planned.reading.excessRatio;
        if (
          !best ||
          readingOrder < 0 ||
          score < best.score ||
          (score === best.score && size < best.fontSize)
        ) {
          best = { fontSize: size, lines: planned.lines, reading: planned.reading, score };
        }
      }
    };

    // shortcut: 大气泡先取样再细化，发现漏选可见字号时再扩大搜索。
    let step = Math.max(1, Math.ceil((maximum - minimum) / FONT_PROBES));
    for (let size = minimum; size <= maximum; size += step) try_size(size);
    try_size(maximum);
    while (best && step > 1) {
      const size = best.fontSize;
      step = Math.ceil(step / 2);
      try_size(size - step);
      try_size(size + step);
    }
    if (
      best &&
      best.reading.topGap === 0 &&
      best.reading.badLines === 0 &&
      best.reading.excessRatio === 0
    ) {
      break;
    }
  }

  if (!best) return undefined;
  let markIndex = 0;
  return {
    fontSize: best.fontSize,
    lines: best.lines.map(({ text, slot, inlineStart }) => ({
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

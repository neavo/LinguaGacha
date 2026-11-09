/** 语音识别结果的整理：CTC 解码、token 时间与句级条目。前处理在 `media.py`，推理在 Worker。 */

/** 工程原文语言到 SenseVoice 语言的映射。有音轨的素材只支持这些语言，对白全部来自本地识别。 */
export const ASR_LANGUAGES = Object.freeze({
  ZH: "zh",
  EN: "en",
  JA: "ja",
  KO: "ko",
  ALL: "auto",
});
/** SenseVoice 导出的语言控制编号（官方 `export_meta.py`）。 */
export const ASR_LANGUAGE_IDS: Readonly<Record<string, number>> = Object.freeze({
  auto: 0,
  zh: 3,
  en: 4,
  ja: 11,
  ko: 12,
});
export const ASR_TEXT_NORM = 14; // 输出带标点与逆文本规范化（withitn）。
const ASR_CONTROL_TOKENS = 4; // 输出前四个位置是语言、情感、事件与规范化标记。
const ASR_FRAME_SECONDS = 0.06; // 10 ms 帧移 × LFR 6 帧。
const ASR_BLANK = 0;

export type AsrWindow = Readonly<{
  from: number; // 窗口起点采样。
  end: number;
  tokens: readonly string[];
  timestamps: readonly number[]; // 相对窗口起点的秒数。
}>;
export type AsrSentence = { start: number; end: number; text: string; tokens: [string, number][] };

const SAMPLE_RATE = 16000;
const PUNCTUATION = /[\s\p{P}]/gu; // 只含标点的识别结果没有台词。
// 句级条目的显示限制。时间超限或字数超限的句子按 token 边界均衡拆开。
const CUE_SECONDS = 7;
const DENSE_CHARS = 30; // 中日韩文字的单条字数上限。
const SPACED_CHARS = 84; // 以空格分词文字的单条字数上限。
const SHORT_SECONDS = 1; // 更短的片段并入相邻句，避免 `Mr.` 这类缩写单独闪烁。
const TAIL_SECONDS = 0.6; // token 只有起点，句尾最多延到末 token 起点后这么久。
const DENSE = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u; // 按字计长的文字。
const UNSPACED = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}ー"; // 词间不用空格的文字，任意字间可切。
const UNSPACED_START = new RegExp(`^[${UNSPACED}]`, "u");
// SenseVoice 会在日文词间插入空格，至少一侧是这类文字时去掉。
const UNSPACED_GAP = new RegExp(
  `(?<=[${UNSPACED}、。，！？「」])\\s+(?=[${UNSPACED}\\d])|(?<=[${UNSPACED}\\d])\\s+(?=[${UNSPACED}])`,
  "gu",
);
const SENTENCE_END = /[.?!。？！…]$/u;
const CLAUSE_END = /[,，、;；:：]$/u;
const CLAUSE_PREFERENCE = 0.25; // 逗号边界相对均分目标的偏好权重。

const round = (value: number): number => Number(value.toFixed(2)); // 区间时间统一保留两位小数。

/**
 * CTC 贪心解码：逐帧取最大类，合并相邻重复并去掉 blank，再去掉四个控制 token。
 * 时间是 token 首帧相对控制位之后的秒数。`▁` 是词首标记，换成空格供拆句判断词边界。
 */
export function ctc_decode(
  logits: Float32Array,
  classes: number,
  length: number,
  vocabulary: readonly string[],
): { tokens: string[]; timestamps: number[] } {
  const ids: number[] = [],
    frames: number[] = [];
  let previous = -1;
  for (let frame = 0; frame < length; frame++) {
    let best = 0;
    const base = frame * classes;
    for (let k = 1; k < classes; k++) if (logits[base + k]! > logits[base + best]!) best = k;
    if (best !== ASR_BLANK && best !== previous) {
      ids.push(best);
      frames.push(frame);
    }
    previous = best;
  }
  return {
    tokens: ids.slice(ASR_CONTROL_TOKENS).map((id) => {
      const token = vocabulary[id];
      if (token === undefined) throw new Error(`Unknown token id: ${id}`);
      return token.replaceAll("▁", " ");
    }),
    timestamps: frames
      .slice(ASR_CONTROL_TOKENS)
      .map((frame) => ASR_FRAME_SECONDS * (frame - ASR_CONTROL_TOKENS)),
  };
}

/** 排序并合并相接或重叠的区间。 */
export function union(spans: readonly (readonly [number, number])[]): [number, number][] {
  const result: [number, number][] = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}

/** 人声采样区间与识别窗口转为整片秒数的 `speech` 与 `asr`。模型按最长语音拆开的相接区间不是停顿。 */
export function speech_result(
  spans: readonly (readonly [number, number])[],
  windows: readonly AsrWindow[],
): { speech: [number, number][]; asr: AsrSentence[] } {
  return {
    speech: union(spans).map(([start, end]) => [
      round(start / SAMPLE_RATE),
      round(end / SAMPLE_RATE),
    ]),
    asr: windows.flatMap((window) =>
      sentences(
        window.from / SAMPLE_RATE,
        window.end / SAMPLE_RATE,
        window.tokens,
        window.timestamps,
      ),
    ),
  };
}

/** 识别文字的显示整理只动空白，不增删字词。 */
const tidy = (text: string): string => text.trim().replace(UNSPACED_GAP, "");

/**
 * 将窗口内 token 时间换算为整片秒数，生成句级条目 `{ start, end, text, tokens }`。
 * 标点 token 的时间常落在窗口末尾，句子边界只参考文字 token。
 * `tokens` 只保留文字 token 的 `[原文, 起点]`，供按硬字幕拆句、合句时取切点。
 */
export function sentences(
  from: number,
  end: number,
  tokens: readonly string[],
  timestamps: readonly number[],
): AsrSentence[] {
  const limit = DENSE.test(tokens.join("")) ? DENSE_CHARS : SPACED_CHARS;
  const at = (k: number): number => (k < tokens.length ? from + timestamps[k]! : end); // token 起点，越界为窗口终点。
  const word = (k: number): boolean => tokens[k]!.replace(PUNCTUATION, "") !== ""; // 排除标点与空白 token。
  /** [i, j) 的首个文字 token 起点。 */
  const begin = (i: number, j: number): number => {
    let k = i;
    while (k < j - 1 && !word(k)) k++;
    return at(k);
  };
  /** 句尾避开标点时间，保留有限阅读留白。 */
  const close = (i: number, j: number): number => {
    let k = j - 1,
      next = j;
    while (k > i && !word(k)) k--;
    while (next < tokens.length && !word(next)) next++;
    return Math.min(at(next), at(k) + TAIL_SECONDS);
  };
  const text = (i: number, j: number): string => tidy(tokens.slice(i, j).join("")); // 区间内的显示正文。
  // 字数与时长同时限制，避免字幕过密。
  const fits = (i: number, j: number): boolean =>
    close(i, j) - begin(i, j) <= CUE_SECONDS && [...text(i, j)].length <= limit;
  // 以空格分词的文字只在词首切开，不切开子词。前后 token 相隔过久说明前一个已经说完，也可切开。
  const breakable = (b: number): boolean =>
    /^\s/u.test(tokens[b]!) ||
    UNSPACED_START.test(tokens[b]!) ||
    /\p{P}$/u.test(tokens[b - 1]!) ||
    at(b) - at(b - 1) > TAIL_SECONDS;
  /** 每次切下约 1/n，n 是满足时长与字数所需的最少条数。 */
  const split = (i: number, j: number): [number, number][] => {
    if (fits(i, j)) return [[i, j]];
    const total = [...text(i, j)].length;
    const share =
      1 /
      Math.max(2, Math.ceil((close(i, j) - begin(i, j)) / CUE_SECONDS), Math.ceil(total / limit));
    let best: number | undefined, cost: number | undefined; // 当前切点与偏离均分目标的代价。
    for (let b = i + 1; b < j; b++) {
      if (!breakable(b)) continue;
      const score =
        Math.abs([...text(i, b)].length / total - share) -
        (CLAUSE_END.test(tokens[b - 1]!.trim()) ? CLAUSE_PREFERENCE * share : 0);
      if (cost === undefined || score < cost) [best, cost] = [b, score];
    }
    return best === undefined ? [[i, j]] : [...split(i, best), ...split(best, j)];
  };
  const pieces: [number, number][] = [];
  let start = 0;
  tokens.forEach((token, k) => {
    // 只有数字间的小数点跳过断句，数字前的其它句末标点仍然生效。
    const decimal =
      /\d\.$/u.test((tokens[k - 1] ?? "") + token.trim()) && /^\d/u.test(tokens[k + 1] ?? "");
    if (SENTENCE_END.test(token.trim()) && !decimal) {
      pieces.push(...split(start, k + 1));
      start = k + 1;
    }
  });
  if (start < tokens.length) pieces.push(...split(start, tokens.length));
  const cues: [number, number][] = [];
  const short = (a: number, b: number): boolean => close(a, b) - begin(a, b) < SHORT_SECONDS; // 判断是否需要合并短句。
  for (const [i, j] of pieces) {
    const last = cues.at(-1);
    if (last && (short(...last) || short(i, j)) && fits(last[0], j)) last[1] = j;
    else cues.push([i, j]);
  }
  return cues.flatMap(([i, j]) => {
    const message = text(i, j);
    if (!message.replace(PUNCTUATION, "")) return [];
    const start = round(begin(i, j));
    const words: [string, number][] = [];
    for (let k = i; k < j; k++) if (word(k)) words.push([tokens[k]!, round(at(k))]);
    // 相邻 token 起点可能相同，取整后仍须保持合法区间。
    return [
      {
        start,
        end: Math.max(round(close(i, j)), round(start + 0.01)),
        text: message,
        tokens: words,
      },
    ];
  });
}

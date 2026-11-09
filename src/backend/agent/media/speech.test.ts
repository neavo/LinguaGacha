import { expect, it } from "vitest";
import { ctc_decode, sentences, speech_result } from "./speech";

const VOCABULARY = ["<blank>", "<lang>", "<emo>", "<event>", "<itn>", "▁hi", "!"];

/** 每帧一个最大类的 logits。 */
function logits(classes: readonly number[]): Float32Array {
  const data = new Float32Array(classes.length * VOCABULARY.length);
  classes.forEach((best, frame) => (data[frame * VOCABULARY.length + best] = 1));
  return data;
}

it("decodes CTC output after the four control positions within the valid length", () => {
  // 控制位 4 帧，重复帧合并，blank 隔开的重复视为新 token，有效长度之外的帧忽略。
  const frames = [1, 2, 3, 4, 5, 5, 0, 5, 6, 6];
  const result = ctc_decode(logits(frames), VOCABULARY.length, 9, VOCABULARY);
  expect(result.tokens).toEqual([" hi", " hi", "!"]);
  expect(result.timestamps.map((value) => Number(value.toFixed(2)))).toEqual([0, 0.18, 0.24]);
});

it("splits sentences at sentence-ending punctuation using word token times", () => {
  const tokens = ["こ", "ん", "に", "ち", "は", "。", "さ", "よ", "う", "な", "ら", "。"];
  const times = [0, 0.4, 0.8, 1.2, 1.6, 1.8, 3, 3.4, 3.8, 4.2, 4.6, 4.8];
  expect(sentences(10, 16, tokens, times)).toEqual([
    {
      start: 10,
      end: 12.2,
      text: "こんにちは。",
      tokens: [
        ["こ", 10],
        ["ん", 10.4],
        ["に", 10.8],
        ["ち", 11.2],
        ["は", 11.6],
      ],
    },
    {
      start: 13,
      end: 15.2,
      text: "さようなら。",
      tokens: [
        ["さ", 13],
        ["よ", 13.4],
        ["う", 13.8],
        ["な", 14.2],
        ["ら", 14.6],
      ],
    },
  ]);
});

it("keeps dense subtitles within the character limit", () => {
  const tokens = Array.from({ length: 40 }, () => "あ");
  const cues = sentences(
    0,
    5,
    tokens,
    tokens.map((_, index) => index * 0.1),
  );
  expect(cues.length).toBeGreaterThan(1);
  expect(cues.every((cue) => [...cue.text].length <= 30)).toBe(true);
  expect(cues.map((cue) => cue.text).join("")).toBe("あ".repeat(40));
});

it("converts sample spans and windows into whole-film seconds", () => {
  const result = speech_result(
    [
      [16000, 32000],
      [0, 16000],
      [48000, 64000],
    ],
    [{ from: 48000, end: 64000, tokens: [" yes", "."], timestamps: [0.1, 0.5] }],
  );
  // 模型按最长语音拆开的相接区间合并为一段。
  expect(result.speech).toEqual([
    [0, 2],
    [3, 4],
  ]);
  expect(result.asr).toEqual([{ start: 3.1, end: 3.7, text: "yes.", tokens: [[" yes", 3.1]] }]);
});

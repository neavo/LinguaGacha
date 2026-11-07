import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const AUDIO_RESOLUTION = { width: 1920, height: 1080 }; // 纯音频没有画面尺寸。
const FONT = "Arial";
const FONT_HEIGHT_RATIO = 0.045;
const MARGIN_HEIGHT_RATIO = 0.04;
const STYLES = { dialogue: ["Dialogue", 2], screen: ["Screen", 8] }; // 名称与 ASS 小键盘对齐位置。

/**
 * 默认渲染：按写回输入生成译文 ASS 和双语 ASS。
 * 定制样式时复制本文件为包目录的 `render.mjs` 修改，保持导出签名不变。
 * `source` 是包目录，`input` 是该资产的写回输入 `items.json`。
 */
export async function render({ source, input, translated, bilingual }) {
  const read = async (file) => JSON.parse(await readFile(file, "utf8"));
  const { video } = await read(path.join(source, "video.json"));
  const originals = await read(path.join(source, "items.json"));
  const targets = await read(input);
  if (targets.length !== originals.length) throw new Error("写回输入与包内记录数不一致");
  const { width, height } = video ?? AUDIO_RESOLUTION;
  const size = Math.max(1, Math.round(height * FONT_HEIGHT_RATIO));
  const margin = Math.round(height * MARGIN_HEIGHT_RATIO);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...Object.values(STYLES).map(
      ([name, align]) =>
        `Style: ${name},${FONT},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,${align},${margin},${margin},${margin},1`,
    ),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const single = [...header];
  const dual = [...header];
  targets.forEach((cue, row) => {
    const { start, end, kind, an } = cue;
    if (
      !(
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        0 <= start &&
        start < end &&
        Object.hasOwn(STYLES, kind)
      )
    )
      throw new Error(`第 ${row} 行时间或类型不合法`);
    const [style, align] = STYLES[kind];
    // 画面文字按识别到的位置覆盖样式默认对齐。
    const position =
      Number.isInteger(an) && an >= 1 && an <= 9 && an !== align ? `{\\an${an}}` : "";
    // ASS 只有百分秒精度，向外取整保留不足一帧的合法字幕。
    const prefix = `Dialogue: 0,${time(Math.floor(start * 100))},${time(Math.ceil(end * 100))},${style},,0,0,0,,${position}`;
    const source_text = originals[row].message;
    single.push(prefix + text(cue.message));
    dual.push(
      prefix +
        (cue.message.trim() !== "" && cue.message !== source_text
          ? text(source_text) + "\\N"
          : "") +
        text(cue.message),
    );
  });
  for (const [file, lines] of [
    [translated, single],
    [bilingual, dual],
  ]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, lines.join("\n") + "\n");
  }
}

/** 百分秒整数只在序列化时拆为 ASS 时间码。 */
function time(value) {
  return `${Math.floor(value / 360000)}:${String(Math.floor(value / 6000) % 60).padStart(2, "0")}:${String(Math.floor(value / 100) % 60).padStart(2, "0")}.${String(value % 100).padStart(2, "0")}`;
}

/** 正文转义隔离用户文本与 ASS 控制语法。 */
function text(value) {
  // 零宽字符隔开原文反斜线与 N/n/h，避免 libass 将字面文本解释为转义。
  return value
    .replace(/\\/gu, "\\⁠")
    .replace(/\{/gu, "\\{")
    .replace(/\}/gu, "\\}")
    .replace(/\r\n|\r|\n/gu, "\\N");
}

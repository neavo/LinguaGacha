import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  read_media_items,
  read_media_package_manifest,
  read_media_writeback_items,
} from "@lg/media";

const AUDIO_RESOLUTION = { width: 1920, height: 1080 }; // 纯音频没有画面尺寸。
const FONT = "Arial"; // 视频字幕由播放器所在系统提供字体。
const TEXT_COLOUR = "&H00FFFFFF"; // 视频字幕：白字。
const AUDIO_FONT = "LGBaseFont"; // 应用随附字体，成片从 `fontsDirectory` 加载。
const AUDIO_SIZE = 48; // 纯音频译文字号。
const SOURCE_SIZE = 30; // 纯音频双语中的原文字号。
const AUDIO_MARGIN = 108; // 纯音频字幕距画面底边。
const AUDIO_COLOUR = "&H002C2725"; // 纯音频译文：适配亮色底图的深色字。
const SOURCE_COLOUR = "&H007D736B"; // 纯音频原文：比译文浅一档。
const FONT_HEIGHT_RATIO = 0.045; // 字号相对画面高度的比例。
const MARGIN_HEIGHT_RATIO = 0.04; // 边距相对画面高度的比例。
const LINE_HEIGHT = 1.2; // 行高相对字号的倍数。
const DENSE_WIDTH = 1; // 中日韩文字的估算字宽（字号倍数）。
const SPACED_WIDTH = 0.55; // 其他字符的估算字宽（字号倍数）。
const DENSE = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}＀-￯]/u; // 全角字符。
const TEXT_LEAD_SECONDS = 1; // 文字区间起点在 1 fps 下最多晚 1 秒。
const SCREEN_GAP = 0.3; // 画面文字译文与原文框的间距（字号倍数）。
const OUTLINE_COLOUR = "&H00000000"; // 描边：不透明黑色。
const VIDEO_OUTLINE = 3; // 描边宽度，单位为 ASS 像素。
const TAIL_SECONDS = 0.2; // 对话结束后的阅读留白。
const MIN_SECONDS = 0.7; // 对话的最短显示时长，避免短句一闪而过。
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** 从包目录 `source` 和写回文件 `input` 生成译文 ASS 和双语 ASS。 */
export async function render({ source, input, translated, bilingual }) {
  const read = async (file) => JSON.parse(await readFile(file, "utf8")); // 读取包内记录与写回输入。
  const manifest = read_media_package_manifest(await read(path.join(source, "media.json")));
  const { video, duration, text } = manifest;
  const originals = read_media_items(await read(path.join(source, "items.json")), duration, video);
  const targets = read_media_writeback_items(await read(input), duration, video);
  if (targets.length !== originals.length) throw new Error("写回输入与包内记录数不一致"); // 按数组下标配对原文和译文。
  const { width, height } = video ?? AUDIO_RESOLUTION;
  const audio = video === null;
  const size = audio ? AUDIO_SIZE : Math.max(1, Math.round(height * FONT_HEIGHT_RATIO));
  const margin = audio ? AUDIO_MARGIN : Math.round(height * MARGIN_HEIGHT_RATIO);
  const [font, colour, outline] = audio
    ? [AUDIO_FONT, AUDIO_COLOUR, 0]
    : [FONT, TEXT_COLOUR, VIDEO_OUTLINE];
  // 画面上已有的文字，避让按区间起点提前 1 秒判断，宁宽勿漏。
  const regions = (text ?? []).map(({ start, end, box }) => ({
    start: start - TEXT_LEAD_SECONDS,
    end,
    rect: [box[0] * width, box[1] * height, box[2] * width, box[3] * height],
  }));
  // 两种 ASS 样式共用字形外观，分别指定底部和顶部对齐。
  const style = (name, align) =>
    `Style: ${name},${font},${size},${colour},&H00FFFFFF,${OUTLINE_COLOUR},&HFF000000,0,0,0,0,100,100,0,0,1,${outline},0,${align},${margin},${margin},${margin},1`;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Dialogue", 2),
    style("Screen", 8),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  /** 按字数估算文字占用的宽高，自动换行按可用宽度折算。 */
  const measure = (value) => {
    const available = width - 2 * margin;
    let lines = 0,
      widest = 0;
    for (const line of value.split(/\r\n|\r|\n/u)) {
      const line_width = units(line) * size;
      lines += Math.max(1, Math.ceil(line_width / available));
      widest = Math.max(widest, Math.min(available, line_width));
    }
    return { w: widest, h: lines * size * LINE_HEIGHT };
  };
  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; // 边缘相接不算遮挡。

  // 随附 libass 未启用 Unicode 自动断行，音频字幕先按字宽换行，再交给它摆放整个双语块。
  const wrap_audio = (value, font_size) => {
    const limit = (width - 2 * margin) / font_size;
    return value
      .split(/\r\n|\r|\n/u)
      .flatMap((line) => {
        const lines = [];
        let current = "";
        const append = (part) => {
          if (current && units(current + part) > limit) {
            lines.push(current.trimEnd());
            current = "";
          }
          current += current ? part : part.trimStart();
        };
        for (const { segment } of WORD_SEGMENTER.segment(line)) {
          if (units(segment) <= limit) append(segment);
          else for (const { segment: part } of GRAPHEME_SEGMENTER.segment(segment)) append(part);
        }
        lines.push(current.trimEnd());
        return lines;
      })
      .join("\n");
  };

  // 重复起点最后一次覆盖，使同起点对白都指向下一组对白。
  const next_starts = new Map(
    targets
      .filter((cue) => cue.kind === "dialogue")
      .map((cue) => cue.start)
      .sort((a, b) => a - b)
      .map((start, index, starts) => [start, starts[index + 1] ?? duration]),
  );

  /** 两份 ASS 分别按各自的画面文字内容计算避让位置。 */
  const events = (with_source) => {
    const placed = []; // 已摆放的画面文字译文。
    return targets.map((cue, row) => {
      const { start, kind, box, message } = cue;
      let { end } = cue;
      const original = originals[row].message;
      const show_original = with_source && message.trim() !== "" && message !== original;
      const caption = !audio && show_original ? `${original}\n${message}` : message;
      const name = kind === "dialogue" ? "Dialogue" : "Screen";
      let tags = "";
      if (kind === "dialogue") {
        // 留白只延长显示，不越过下一句对话和片尾。本已重叠的多人对话保持原样。
        const next = next_starts.get(start);
        end = Math.max(
          end,
          Math.min(Math.max(end + TAIL_SECONDS, start + MIN_SECONDS), next, duration),
        );
      } else if (box) {
        const { w, h } = measure(caption);
        const source_rect = [box[0] * width, box[1] * height, box[2] * width, box[3] * height];
        const gap = size * SCREEN_GAP;
        const x = Math.min(Math.max((source_rect[0] + source_rect[2]) / 2, w / 2), width - w / 2);
        const active = (item) => item.start < end && start < item.end; // 半开时间区间。
        const blockers = [
          ...regions
            .filter((region) => active(region) && !overlaps(region.rect, source_rect))
            .map((region) => region.rect),
          ...placed.filter(active).map((item) => item.rect),
        ];
        // 按寻找方向依次跨过障碍，以字幕顶边计算候选位置。
        const position = (below) => {
          let y = below ? source_rect[3] + gap : source_rect[1] - gap - h;
          const ordered = blockers.toSorted((a, b) => (below ? a[1] - b[1] : b[3] - a[3]));
          for (const other of ordered)
            if (overlaps(other, [x - w / 2, y, x + w / 2, y + h]))
              y = below ? other[3] + gap : other[1] - gap - h;
          return y;
        };
        const fits = (top) => top >= 0 && top + h <= height;
        let y = position(true);
        if (!fits(y)) {
          const above = position(false);
          y = fits(above) ? above : Math.max(0, Math.min(height - h, y)); // 上下均无空位时优先保证可见。
        }
        placed.push({ start, end, rect: [x - w / 2, y, x + w / 2, y + h] });
        tags = `{\\an8\\pos(${Math.round(x)},${Math.round(y)})}`;
      }
      const body = escape(audio ? wrap_audio(caption, size) : caption);
      // 纯音频双语把小字号原文与译文放在同一事件中，由 libass 整体避让。
      const source_line =
        audio && show_original
          ? `\\N{\\fs${SOURCE_SIZE}\\c${SOURCE_COLOUR}}${escape(wrap_audio(original, SOURCE_SIZE))}`
          : "";
      // ASS 只有百分秒精度，向外取整保留不足一帧的合法字幕。
      return `Dialogue: 0,${time(Math.floor(start * 100))},${time(Math.ceil(end * 100))},${name},,0,0,0,,${tags}${body}${source_line}`;
    });
  };

  for (const [file, lines] of [
    [translated, events(false)],
    [bilingual, events(true)],
  ]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, [...header, ...lines].join("\n") + "\n");
  }
}

/** 按字数估算一行文字的宽度，单位是字号。 */
function units(line) {
  return [...line].reduce((sum, char) => sum + (DENSE.test(char) ? DENSE_WIDTH : SPACED_WIDTH), 0);
}

/** 百分秒整数只在序列化时拆为 ASS 时间码。 */
function time(value) {
  return `${Math.floor(value / 360000)}:${String(Math.floor(value / 6000) % 60).padStart(2, "0")}:${String(Math.floor(value / 100) % 60).padStart(2, "0")}.${String(value % 100).padStart(2, "0")}`;
}

/** 正文转义隔离用户文本与 ASS 控制语法。 */
function escape(value) {
  // 零宽字符隔开原文反斜线与 N/n/h，避免 libass 将字面文本解释为转义。
  return value
    .replace(/\\/gu, "\\⁠")
    .replace(/\{/gu, "\\{")
    .replace(/\}/gu, "\\}")
    .replace(/\r\n|\r|\n/gu, "\\N");
}

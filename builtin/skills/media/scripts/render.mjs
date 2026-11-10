import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

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
const SHADOW_COLOUR = "&H80000000"; // 阴影：半透明黑色。
const BOX_COLOUR = "&H40000000"; // 对白底框：约 75% 不透明。
const BOX_PADDING = 8; // BorderStyle=4 使用 Shadow 控制整条字幕的底框留白。
const TAIL_SECONDS = 0.2; // 对话结束后的阅读留白。
const MIN_SECONDS = 0.7; // 对话的最短显示时长，避免短句一闪而过。

/**
 * 默认渲染：按写回输入生成译文 ASS 和双语 ASS。
 * 视频：对白在底部居中，与画面上已有文字重叠时逐条改用半透明底框；画面文字的译文贴着原文框摆放。
 * 纯音频：按 1920×1080 成片排版，双语时译文在上、原文在下，两者作为一条事件整体换行与避让。
 * 定制样式时复制本文件为包目录的 `render.mjs` 修改，保持导出签名不变。
 * `source` 是包目录，`input` 是该资产的写回输入 `items.json`。
 */
export async function render({ source, input, translated, bilingual }) {
  const read = async (file) => JSON.parse(await readFile(file, "utf8")); // 读取包内记录与写回输入。
  const { video, duration, text } = await read(path.join(source, "media.json"));
  const originals = await read(path.join(source, "items.json"));
  const targets = await read(input);
  if (targets.length !== originals.length) throw new Error("写回输入与包内记录数不一致");
  const { width, height } = video ?? AUDIO_RESOLUTION;
  const audio = video === null;
  const size = audio ? AUDIO_SIZE : Math.max(1, Math.round(height * FONT_HEIGHT_RATIO));
  const margin = audio ? AUDIO_MARGIN : Math.round(height * MARGIN_HEIGHT_RATIO);
  // 画面上已有的文字，避让按区间起点提前 1 秒判断，宁宽勿漏。
  const regions = (audio ? [] : (text ?? [])).map(({ start, end, box }) => ({
    start: start - TEXT_LEAD_SECONDS,
    end,
    rect: [box[0] * width, box[1] * height, box[2] * width, box[3] * height],
  }));
  /** 三种 ASS 样式共用字段顺序。纯音频在亮色底图上用深色字，不加描边、阴影和底框。 */
  const style = (name, align, border, outline, shadow, back_colour) => {
    const [font, colour, effect] = audio
      ? [AUDIO_FONT, AUDIO_COLOUR, "1,0,0"]
      : [FONT, TEXT_COLOUR, `${border},${outline},${shadow}`];
    return `Style: ${name},${font},${size},${colour},&H00FFFFFF,${OUTLINE_COLOUR},${back_colour},0,0,0,0,100,100,0,0,${effect},${align},${margin},${margin},${margin},1`;
  };
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Dialogue", 2, 1, 2, 0, SHADOW_COLOUR),
    // ASS 不能用行内标签切换 BorderStyle，底框只能另设样式。
    style("DialogueBox", 2, 4, 2, BOX_PADDING, BOX_COLOUR),
    style("Screen", 8, 1, 2, 0, SHADOW_COLOUR),
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
  const during = (start, end) => (item) => item.start < end && start < item.end; // 半开时间区间。

  // 随附 libass 未启用 Unicode 自动断行，音频字幕先按字宽换行，再交给它摆放整个双语块。
  const wrap_audio = (value, font_size) => {
    const limit = (width - 2 * margin) / font_size;
    const words = new Intl.Segmenter(undefined, { granularity: "word" });
    const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
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
        for (const { segment } of words.segment(line)) {
          if (units(segment) <= limit) append(segment);
          else for (const { segment: part } of graphemes.segment(segment)) append(part);
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

  /**
   * 生成一份 ASS 的事件。`content` 给出每行的文本块 `[文字, 字号]`，后续块是小字号原文。
   * 两份输出的行数不同，避让分别计算。
   */
  const events = (content) => {
    const placed = []; // 已摆放的画面文字译文。
    return targets.map((cue, row) => {
      const { start, kind, box } = cue;
      let { end } = cue;
      if (
        !(
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          0 <= start &&
          start < end &&
          (kind === "dialogue" || kind === "screen")
        )
      )
        throw new Error(`第 ${row} 行时间或类型不合法`);
      const blocks = content(cue, row);
      const { w, h } = measure(blocks.map(([value]) => value).join("\n"));
      let name = kind === "dialogue" ? "Dialogue" : "Screen",
        tags = "";
      if (kind === "dialogue") {
        // 留白只延长显示，不越过下一句对话和片尾。本已重叠的多人对话保持原样。
        const next = next_starts.get(start);
        end = Math.max(
          end,
          Math.min(Math.max(end + TAIL_SECONDS, start + MIN_SECONDS), next, duration),
        );
        const area = [(width - w) / 2, height - margin - h, (width + w) / 2, height];
        if (regions.filter(during(start, end)).some((region) => overlaps(region.rect, area)))
          name = "DialogueBox";
      } else if (box) {
        // 分别寻找原文框下方和上方的空位，先采用画面内的下方位置。
        const source_rect = [box[0] * width, box[1] * height, box[2] * width, box[3] * height];
        const gap = size * SCREEN_GAP;
        const x = Math.min(Math.max((source_rect[0] + source_rect[2]) / 2, w / 2), width - w / 2);
        const others = [
          ...regions
            .filter(during(start, end))
            .map((region) => region.rect)
            .filter((rect) => !overlaps(rect, source_rect)),
          ...placed.filter(during(start, end)).map((item) => item.rect),
        ];
        const positions = [true, false].map((below) => {
          let y = below ? source_rect[3] + gap : source_rect[1] - gap - h; // 统一以译文顶边定位。
          const blockers = [...others].sort((a, b) => (below ? a[1] - b[1] : b[3] - a[3]));
          for (const other of blockers)
            if (overlaps(other, [x - w / 2, y, x + w / 2, y + h]))
              y = below ? other[3] + gap : other[1] - gap - h;
          return y;
        });
        // shortcut: 画面无空位时保留可见位置，复杂排版需求使用定制渲染。
        const y =
          positions.find((top) => top >= 0 && top + h <= height) ??
          Math.max(0, Math.min(height - h, positions[0]));
        placed.push({ start, end, rect: [x - w / 2, y, x + w / 2, y + h] });
        tags = `{\\an8\\pos(${Math.round(x)},${Math.round(y)})}`;
      }
      const body = blocks
        .map(
          ([value, font_size], index) =>
            (index ? `\\N{\\fs${font_size}\\c${SOURCE_COLOUR}}` : "") +
            escape(audio ? wrap_audio(value, font_size) : value),
        )
        .join("");
      // ASS 只有百分秒精度，向外取整保留不足一帧的合法字幕。
      return `Dialogue: 0,${time(Math.floor(start * 100))},${time(Math.ceil(end * 100))},${name},,0,0,0,,${tags}${body}`;
    });
  };

  const single = events((cue) => [[cue.message, size]]);
  const dual = events((cue, row) => {
    const source_text = originals[row].message;
    if (cue.message.trim() === "" || cue.message === source_text) return [[cue.message, size]];
    // 纯音频译文在上、原文小字在下，同一事件让 libass 整体换行和避让。视频原文在前。
    return audio
      ? [
          [cue.message, size],
          [source_text, SOURCE_SIZE],
        ]
      : [[`${source_text}\n${cue.message}`, size]];
  });
  for (const [file, lines] of [
    [translated, single],
    [bilingual, dual],
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

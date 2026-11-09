import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const AUDIO_RESOLUTION = { width: 1920, height: 1080 }; // 纯音频没有画面尺寸。
const FONT = "Arial";
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
const BOX_COLOUR = "&H40000000"; // 对白底框：约 75% 不透明。实测 &H60 时底下的硬字幕仍隐约可见。
const BOX_PADDING = 8; // 底框内边距（ASS `Outline`）。
const TAIL_SECONDS = 0.2; // 对话结束后的阅读留白。
const MIN_SECONDS = 0.7; // 对话的最短显示时长，避免短句一闪而过。

/**
 * 默认渲染：按写回输入生成译文 ASS 和双语 ASS。
 * 对白在底部居中，与画面上已有文字重叠时逐条改用半透明底框；画面文字的译文贴着原文框摆放。
 * 定制样式时复制本文件为包目录的 `render.mjs` 修改，保持导出签名不变。
 * `source` 是包目录，`input` 是该资产的写回输入 `items.json`。
 */
export async function render({ source, input, translated, bilingual }) {
  const read = async (file) => JSON.parse(await readFile(file, "utf8")); // 读取包内记录与写回输入。
  const { video, duration, text } = await read(path.join(source, "video.json"));
  const originals = await read(path.join(source, "items.json"));
  const targets = await read(input);
  if (targets.length !== originals.length) throw new Error("写回输入与包内记录数不一致");
  const { width, height } = video ?? AUDIO_RESOLUTION;
  const size = Math.max(1, Math.round(height * FONT_HEIGHT_RATIO));
  const margin = Math.round(height * MARGIN_HEIGHT_RATIO);
  // 画面上已有的文字，避让按区间起点提前 1 秒判断，宁宽勿漏。
  const regions = (text ?? []).map(({ start, end, box }) => ({
    start: start - TEXT_LEAD_SECONDS,
    end,
    rect: [box[0] * width, box[1] * height, box[2] * width, box[3] * height],
  }));
  /** 三种 ASS 样式共用字段顺序，描边与底框参数由调用者指定。 */
  const style = (name, align, border, outline, outline_colour, back_colour) =>
    `Style: ${name},${FONT},${size},&H00FFFFFF,&H00FFFFFF,${outline_colour},${back_colour},0,0,0,0,100,100,0,0,${border},${outline},0,${align},${margin},${margin},${margin},1`;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Dialogue", 2, 1, 2, OUTLINE_COLOUR, SHADOW_COLOUR),
    // ASS 不能用行内标签切换 BorderStyle，底框只能另设样式。
    style("DialogueBox", 2, 3, BOX_PADDING, BOX_COLOUR, BOX_COLOUR),
    style("Screen", 8, 1, 2, OUTLINE_COLOUR, SHADOW_COLOUR),
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
      let units = 0;
      for (const char of line) units += DENSE.test(char) ? DENSE_WIDTH : SPACED_WIDTH;
      lines += Math.max(1, Math.ceil((units * size) / available));
      widest = Math.max(widest, Math.min(available, units * size));
    }
    return { w: widest, h: lines * size * LINE_HEIGHT };
  };
  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; // 边缘相接不算遮挡。
  const during = (start, end) => (item) => item.start < end && start < item.end; // 半开时间区间。

  // 重复起点最后一次覆盖，使同起点对白都指向下一组对白。
  const next_starts = new Map(
    targets
      .filter((cue) => cue.kind === "dialogue")
      .map((cue) => cue.start)
      .sort((a, b) => a - b)
      .map((start, index, starts) => [start, starts[index + 1] ?? duration]),
  );

  /** 生成一份 ASS 的事件。`content` 给出每行的显示文字，两份输出的行数不同，避让分别计算。 */
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
      const value = content(cue, row);
      const { w, h } = measure(value);
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
      // ASS 只有百分秒精度，向外取整保留不足一帧的合法字幕。
      return `Dialogue: 0,${time(Math.floor(start * 100))},${time(Math.ceil(end * 100))},${name},,0,0,0,,${tags}${escape(value)}`;
    });
  };

  const single = events((cue) => cue.message);
  const dual = events((cue, row) => {
    const source_text = originals[row].message;
    return cue.message.trim() !== "" && cue.message !== source_text
      ? `${source_text}\n${cue.message}`
      : cue.message;
  });
  for (const [file, lines] of [
    [translated, single],
    [bilingual, dual],
  ]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, [...header, ...lines].join("\n") + "\n");
  }
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

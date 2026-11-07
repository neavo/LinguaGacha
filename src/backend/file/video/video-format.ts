import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";
import { create_item, type Item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import { read_zip_members } from "../shared/zip-members";
import { read_translation_for_generation } from "../shared/translation-generation-text";
import { needs_bilingual_text, type SubtitleOutput } from "../subtitle/subtitle-text";

export const VIDEO_MANIFEST_MEMBER = "video.json";
const TIME = Type.Number({ minimum: 0 });
export const VIDEO_SCHEMA = Type.Object(
  {
    video: Type.Union([
      Type.Null(),
      Type.Object(
        { width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) },
        { additionalProperties: false },
      ),
    ]),
    segments: Type.Array(
      Type.Object(
        { path: Type.String({ pattern: "^segments/[^/\\\\]+\\.mp4$" }), start: TIME, end: TIME },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    cues: Type.Array(
      Type.Object(
        {
          start: TIME,
          end: TIME,
          kind: Type.Union([Type.Literal("dialogue"), Type.Literal("screen")]),
          text: Type.String({ pattern: "\\S" }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
const VALIDATOR = Compile(VIDEO_SCHEMA);
const AUDIO_RESOLUTION = { width: 1920, height: 1080 };
const FONT = "Arial";
const FONT_HEIGHT_RATIO = 0.045;
const MARGIN_HEIGHT_RATIO = 0.04;

/** 包内保存确定的原文。识别归技能，译文状态归工程条目。 */
export class VideoFormat {
  /** 完整校验后才返回清单，避免坏行改变后续条目坐标。 */
  private async read_manifest(
    content: Uint8Array,
    file: string,
  ): Promise<Static<typeof VIDEO_SCHEMA>> {
    try {
      const members = await read_zip_members(content, file);
      const member = members.get(VIDEO_MANIFEST_MEMBER);
      if (!member) throw new Error("Missing video manifest");
      const data: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await member.async("uint8array")),
      );
      if (!VALIDATOR.Check(data)) throw new Error("Invalid video manifest");
      let end = 0;
      const paths = new Set<string>();
      for (const segment of data.segments) {
        if (
          segment.start !== end ||
          segment.end <= segment.start ||
          !members.has(segment.path) ||
          paths.has(segment.path)
        )
          throw new Error("Invalid video segments");
        paths.add(segment.path);
        end = segment.end;
      }
      let start = 0;
      for (const cue of data.cues) {
        if (cue.start < start || cue.end <= cue.start || cue.end > end)
          throw new Error("Invalid video cue timeline");
        start = cue.start;
      }
      return data;
    } catch (cause) {
      throw new AppError("file.invalid_structure", { cause, public_details: { file } });
    }
  }

  /** 清单下标直接成为工程条目的行号。 */
  public async read_from_stream(content: Uint8Array, file: string): Promise<Item[]> {
    return (await this.read_manifest(content, file)).cues.map((cue, row) =>
      create_item({ src: cue.text, row, file_type: "VIDEO", file_path: file }),
    );
  }

  /** 先核对原文坐标，再由同一清单生成两份字幕。 */
  public async render(
    content: Uint8Array,
    items: readonly Item[],
    file: string,
  ): Promise<SubtitleOutput> {
    const manifest = await this.read_manifest(content, file);
    const targets = new Map<number, string>();
    for (const item of items) {
      if (manifest.cues[item.row]?.text !== item.src || targets.has(item.row))
        throw new AppError("file.invalid_structure", { public_details: { file } });
      targets.set(item.row, read_translation_for_generation(item) ?? item.src);
    }
    const { width, height } = manifest.video ?? AUDIO_RESOLUTION;
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
      ...[
        ["Dialogue", 2],
        ["Screen", 8],
      ].map(
        ([name, align]) =>
          `Style: ${name},${FONT},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,${align},${margin},${margin},${margin},1`,
      ),
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ];
    const translated = [...header];
    const bilingual = [...header];
    manifest.cues.forEach((cue, row) => {
      const target = targets.get(row) ?? cue.text;
      // ASS 只有百分秒精度，向外取整保留不足一帧的合法字幕。
      const prefix = `Dialogue: 0,${ass_time(Math.floor(cue.start * 100))},${ass_time(Math.ceil(cue.end * 100))},${cue.kind === "dialogue" ? "Dialogue" : "Screen"},,0,0,0,,`;
      translated.push(prefix + ass_text(target));
      bilingual.push(
        prefix +
          (needs_bilingual_text(cue.text, target) ? ass_text(cue.text) + "\\N" : "") +
          ass_text(target),
      );
    });
    return { translated: translated.join("\n") + "\n", bilingual: bilingual.join("\n") + "\n" };
  }
}

/** 百分秒整数只在序列化时拆为 ASS 时间码。 */
function ass_time(value: number): string {
  return `${Math.floor(value / 360000)}:${String(Math.floor(value / 6000) % 60).padStart(2, "0")}:${String(Math.floor(value / 100) % 60).padStart(2, "0")}.${String(value % 100).padStart(2, "0")}`;
}

/** 正文转义隔离用户文本与 ASS 控制语法。 */
function ass_text(text: string): string {
  // 零宽字符隔开原文反斜线与 N/n/h，避免 libass 将字面文本解释为转义。
  return text
    .replace(/\\/gu, "\\\u2060")
    .replace(/\{/gu, "\\{")
    .replace(/\}/gu, "\\}")
    .replace(/\r\n|\r|\n/gu, "\\N");
}

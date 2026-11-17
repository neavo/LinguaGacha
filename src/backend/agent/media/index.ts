/**
 * `@lg/media`：音视频本地识别与画面文字检测的稳定计算能力。
 * 只返回结果或写入调用者指定的工作文件，不读写工程，也不决定最终字幕原文。
 */
import path from "node:path";
import type { TSchema } from "typebox";
import { default_native_fs as fs } from "../../../native/native-fs";
import { inference_configuration } from "../inference/runtime";
import { require_models } from "./preparation";
import { helper, operate, validate_device } from "./engine";
import { ffmpeg_path, inspect } from "./ffmpeg";
import type { DeviceOptions } from "./worker-protocol";
import { MEDIA_MODELS } from "./models";
import { ASR_LANGUAGES, speech_result, type AsrSentence } from "./speech";
import type {
  MediaHelperRequest,
  MediaSheet,
  MediaTextBound,
  MediaTextRegion,
} from "../../../shared/media";
import { MEDIA_ITEMS_SCHEMA, MEDIA_PACKAGE_MANIFEST_SCHEMA } from "../../../shared/media-package";
import { create_schema_renderer } from "../workspace/schema-description";

export type { DeviceOptions } from "./worker-protocol";
export { ffmpeg, inspect, type ExecuteOptions, type MediaInfo } from "./ffmpeg";
export { ASR_LANGUAGES, union, type AsrSentence } from "./speech";

export { missing_models, prepare_models } from "./preparation";
export { DeviceFailure } from "../inference/client";
export { visualize, type VisualizeOptions, type VisualizeResult } from "./visualize";
export {
  MEDIA_ITEMS_SCHEMA,
  MEDIA_PACKAGE_MANIFEST_SCHEMA,
  read_media_items,
  read_media_package_manifest,
  read_media_writeback_items,
  read_media_work_manifest,
} from "../../../shared/media-package";

/** 按需呈现当前 `.media` JSON 形状，领域语义仍由 media skill 说明。 */
export function describe_package(): string {
  return create_schema_renderer(
    new Map<TSchema, string>([
      [MEDIA_PACKAGE_MANIFEST_SCHEMA, "MediaPackageManifest"],
      [MEDIA_ITEMS_SCHEMA, "MediaItems"],
    ]),
  ).declarations();
}

/** 画面文字区间，`box` 为归一化 `[x0, y0, x1, y1]`。 */
export type TextRegion = MediaTextRegion;
export type TextBound = MediaTextBound;
export type RefineRow = Readonly<MediaHelperRequest<"refine">["rows"][number]>;
export type SheetEntry = Readonly<MediaHelperRequest<"sheet">["entries"][number]>;
export type Sheet = MediaSheet;

/**
 * 一次解码完成人声检测与本地识别，返回整片秒数的人声区间与句级条目。
 * 语言取工程原文语言，必须在 `ASR_LANGUAGES` 中。
 */
export async function listen(
  source: string,
  { track = 0, language, device }: Readonly<{ track?: number; language: string }> & DeviceOptions,
): Promise<{ speech: [number, number][]; asr: AsrSentence[] }> {
  validate_device(device);
  require_models(["vad", "vad_mvn", "asr_mvn", "tokens", device === "gpu" ? "asr_gpu" : "asr_cpu"]);
  const code = (ASR_LANGUAGES as Readonly<Record<string, string>>)[language];
  if (code === undefined)
    throw new Error(
      `Local ASR supports ${Object.keys(ASR_LANGUAGES).join(", ")}, not ${language}.`,
    );
  const info = await inspect(source);
  const stream = info.audio[track];
  if (!Number.isInteger(track) || stream === undefined)
    throw new Error(`Audio track ${track} does not exist.`);
  return operate(
    async (engine) => {
      const { spans, windows } = await helper(
        "speech",
        {
          ffmpeg: ffmpeg_path(),
          source,
          track,
          center: /\b[57]\.1\b/u.test(stream), // 5.1、7.1 只取中置声道，实测错误明显少于常规下混。
          language: code,
          vad_mvn: path.join(inference_configuration().modelsDirectory, MEDIA_MODELS.vad_mvn.file),
          asr_mvn: path.join(inference_configuration().modelsDirectory, MEDIA_MODELS.asr_mvn.file),
        },
        engine,
      );
      return speech_result(spans, windows);
    },
    { device },
  );
}

/**
 * 以 1 fps 检测、识别整片画面文字，按位置和内容分段，代表裁图写入 `out/<id>.jpg`。
 * `out` 每次重建，由调用者在成功后发布。
 */
export async function scan(
  source: string,
  { out, device }: Readonly<{ out: string }> & DeviceOptions,
): Promise<TextRegion[]> {
  validate_device(device);
  require_models(["detection", "recognition"]);
  const info = await inspect(source);
  const video = info.video;
  if (!video) throw new Error("Audio-only media has no picture.");
  return operate(
    async (engine) => {
      await fs.remove_async(out, { recursive: true, force: true }); // 重跑不能混入上一轮的裁图。
      const regions = await helper(
        "scan",
        { ffmpeg: ffmpeg_path(), source, ...video, out },
        engine,
      );
      // 区间终点是末次检测加 1 秒，片尾不足一秒的部分截到时长。
      return regions.map((region) => ({ ...region, end: Math.min(region.end, info.duration) }));
    },
    { device },
  );
}

/** 在原文件上以 4 fps 检查小窗口内同一内容的边界，无法确定的边界为 null。 */
export async function refine(
  source: string,
  { rows, device }: Readonly<{ rows: readonly RefineRow[] }> & DeviceOptions,
): Promise<TextBound[]> {
  validate_device(device);
  require_models(["detection", "recognition"]);
  const info = await inspect(source);
  const video = info.video;
  if (!video) throw new Error("Audio-only media has no picture.");
  return operate(
    async (engine) =>
      await helper(
        "refine",
        { ffmpeg: ffmpeg_path(), source, ...video, duration: info.duration, rows: [...rows] },
        engine,
      ),
    { device },
  );
}

/** 把裁图拼成不超过 1280×1280 的图集写入 `out`，返回 `[{ file, ids }]`。 */
export async function sheets(entries: readonly SheetEntry[], out: string): Promise<Sheet[]> {
  return helper("sheet", { entries: [...entries], out });
}

export { INFERENCE_DEPENDENCIES } from "../inference/environment";

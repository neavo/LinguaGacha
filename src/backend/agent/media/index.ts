/**
 * `@lg/media`：音视频本地识别与画面文字检测的稳定计算能力。
 * 只返回结果或写入调用者指定的工作文件，不读写工程，也不决定最终字幕原文。
 */
import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";
import { media_configuration } from "./runtime";
import { ensure_ready } from "./preparation";
import { DecodeFailure, helper, operate, read_json } from "./engine";
import {
  ffmpeg_path,
  hwaccel_candidates,
  inspect,
  video_stream,
  type Hwaccel,
  type MediaInfo,
} from "./ffmpeg";
import { MEDIA_MODELS } from "./models";
import { ASR_LANGUAGES, speech_result, type AsrSentence, type AsrWindow } from "./speech";

export { ffmpeg, inspect, type ExecuteOptions, type MediaInfo } from "./ffmpeg";
export { ASR_LANGUAGES, union, type AsrSentence } from "./speech";

export { missing, setup, type MediaMissing, type MediaPurpose } from "./preparation";
export { visualize, type VisualizeOptions, type VisualizeResult } from "./visualize";

const DECODER_CACHE = "decoder.json"; // 工作目录中的硬解选择，可重建，不进入资产包。

/** 画面文字区间，`box` 为归一化 `[x0, y0, x1, y1]`。 */
export type TextRegion = { id: number; start: number; end: number; at: number; box: number[] };
export type TextBound = { row: number; start: number | null; end: number | null };
export type RefineRow = Readonly<{
  row: number;
  start: number;
  end: number;
  box: readonly number[];
}>;
export type SheetEntry = Readonly<{ id: number; start: number; file: string }>;
export type Sheet = { file: string; ids: number[] };

/**
 * 一次解码完成人声检测与本地识别，返回整片秒数的人声区间与句级条目。
 * 语言取工程原文语言，必须在 `ASR_LANGUAGES` 中。
 */
export async function listen(
  source: string,
  { track = 0, language }: Readonly<{ track?: number; language: string }>,
): Promise<{ speech: [number, number][]; asr: AsrSentence[] }> {
  await ensure_ready(["speech"]);
  const code = (ASR_LANGUAGES as Readonly<Record<string, string>>)[language];
  if (code === undefined)
    throw new Error(
      `Local ASR supports ${Object.keys(ASR_LANGUAGES).join(", ")}, not ${language}.`,
    );
  const info = await inspect(source);
  const stream = info.audio[track];
  if (!Number.isInteger(track) || stream === undefined)
    throw new Error(`Audio track ${track} does not exist.`);
  const { spans, windows } = (await operate((engine) =>
    helper(
      "speech",
      {
        ffmpeg: ffmpeg_path(),
        source,
        track,
        center: /\b[57]\.1\b/u.test(stream), // 5.1、7.1 只取中置声道，实测错误明显少于常规下混。
        language: code,
        vad_mvn: path.join(media_configuration().modelsDirectory, MEDIA_MODELS.vad_mvn.file),
        asr_mvn: path.join(media_configuration().modelsDirectory, MEDIA_MODELS.asr_mvn.file),
      },
      engine,
    ),
  )) as { spans: [number, number][]; windows: AsrWindow[] };
  return speech_result(spans, windows);
}

/**
 * 以 1 fps 检测整片画面文字，返回区间并把各区间代表帧裁图写入 `out/<id>.jpg`。
 * `out` 每次重建，由调用者在成功后发布；`directory` 保存本素材的解码方式选择。
 */
export async function scan(
  source: string,
  { directory, out }: Readonly<{ directory: string; out: string }>,
): Promise<TextRegion[]> {
  await ensure_ready(["text"]);
  const info = await inspect(source);
  const video = info.video;
  if (!video) throw new Error("Audio-only media has no picture.");
  return decoded(directory, source, info, "scan", (hwaccel) =>
    operate(async (engine) => {
      await fs.remove_async(out, { recursive: true, force: true }); // 重跑不能混入上一轮的裁图。
      const regions = (await helper(
        "scan",
        { ffmpeg: ffmpeg_path(), source, ...video, out, hwaccel },
        engine,
      )) as TextRegion[];
      // 区间终点是末次检测加 1 秒，片尾不足一秒的部分截到时长。
      return regions.map((region) => ({ ...region, end: Math.min(region.end, info.duration) }));
    }),
  );
}

/** 在原文件上以 8 fps 二分校准各行文字的出现与消失时间，无法确定的边界为 null。 */
export async function refine(
  source: string,
  { directory, rows }: Readonly<{ directory: string; rows: readonly RefineRow[] }>,
): Promise<TextBound[]> {
  await ensure_ready(["text"]);
  const info = await inspect(source);
  const video = info.video;
  if (!video) throw new Error("Audio-only media has no picture.");
  return decoded(directory, source, info, "refine", (hwaccel) =>
    operate(
      async (engine) =>
        (await helper(
          "refine",
          { ffmpeg: ffmpeg_path(), source, ...video, duration: info.duration, rows, hwaccel },
          engine,
        )) as TextBound[],
    ),
  );
}

/** 把裁图拼成不超过 1280×1280 的图集写入 `out`，返回 `[{ file, ids }]`。 */
export async function sheets(entries: readonly SheetEntry[], out: string): Promise<Sheet[]> {
  await ensure_ready(["text"]);
  return (await helper("sheet", { entries, out })) as Sheet[];
}

type DecoderChoice = { key: string; choice: Record<string, string | null>; timings: unknown };

/**
 * 按本素材实测选择解码方式并缓存。硬解失败时停止本次计算，以软件解码完整重跑一次，
 * 重跑成功后记住该用途改用软件解码。
 */
async function decoded<T>(
  directory: string,
  source: string,
  info: MediaInfo,
  mode: "scan" | "refine",
  run: (hwaccel: Hwaccel | null) => Promise<T>,
): Promise<T> {
  const file = path.join(directory, DECODER_CACHE);
  const stream = video_stream(info.streams)!;
  const candidates = await hwaccel_candidates(stream);
  if (!candidates.length) return run(null);
  const [media, binary] = [fs.stat(source), fs.stat(ffmpeg_path())];
  const key = JSON.stringify([
    source,
    media.size,
    media.mtimeMs,
    stream,
    ffmpeg_path(),
    binary.size,
    binary.mtimeMs,
  ]);
  let cache = read_json(file) as DecoderChoice | undefined;
  if (cache?.key !== key) {
    const measured = (await helper("calibrate", {
      ffmpeg: ffmpeg_path(),
      source,
      ...info.video,
      duration: info.duration,
      candidates,
    })) as { choice: Record<string, number | null>; timings: unknown };
    cache = {
      key,
      choice: Object.fromEntries(
        Object.entries(measured.choice).map(([name, index]) => [
          name,
          index === null ? null : candidates[index]!.name,
        ]),
      ),
      timings: measured.timings,
    };
    fs.write_file_atomic(file, JSON.stringify(cache, null, 2));
  }
  const hwaccel = candidates.find((candidate) => candidate.name === cache.choice[mode]) ?? null;
  if (!hwaccel) return run(null);
  console.log(`画面解码：${hwaccel.name}`);
  try {
    return await run(hwaccel);
  } catch (error) {
    if (!(error instanceof DecodeFailure)) throw error;
    console.warn(
      `硬件解码 ${hwaccel.name} 失败，改用软件解码重新执行：${error instanceof Error ? error.message : String(error)}`,
    );
    const result = await run(null);
    fs.write_file_atomic(
      file,
      JSON.stringify({ ...cache, choice: { ...cache.choice, [mode]: null } }, null, 2),
    );
    return result;
  }
}

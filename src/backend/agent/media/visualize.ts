import { createHash } from "node:crypto";
import { default_native_fs as fs } from "../../../native/native-fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { execute, ffmpeg_path, inspect } from "./ffmpeg";
import { python, runtime_file } from "./engine";
import { ensure_ready } from "./preparation";

const FRAME = { width: 1920, height: 1080 }; // 与 `visualize.py` 的成片尺寸一致。
const DURATION_TOLERANCE = 0.15; // 成片与解码样本时长的允许差（秒），覆盖封装取整。
const LOCK_RETRY = { retries: 40, minTimeout: 250, maxTimeout: 500 }; // 同一输出正在生成时最多等待约 20 秒。

export type VisualizeOptions = Readonly<{
  track: number;
  background: string;
  subtitles: string;
  fonts: string;
  output: string;
}>;
export type VisualizeResult = Readonly<{
  output: string;
  duration: number;
  audio: "copy" | "aac"; // 原音轨直接封入，或转为 AAC。
  // 各阶段秒数与临时占用，供验收记录成本。
  timings: Readonly<Record<string, number>>;
  temporary_bytes: number;
}>;

/**
 * 用纯音频的所选音轨与已生成的双语 ASS 合成固定预设的可视化 MP4。
 * 不读取工程，字幕正文由调用者决定。成片检查通过后才替换 `output`，失败时旧成片保留。
 */
export async function visualize(
  source: string,
  options: VisualizeOptions,
): Promise<VisualizeResult> {
  await ensure_ready();
  const info = await inspect(source);
  if (info.video !== null) throw new Error("Visualization requires audio-only media.");
  if (!Number.isInteger(options.track) || options.track < 0 || !info.audio[options.track])
    throw new Error(`Audio track ${options.track} does not exist.`);
  const output = path.resolve(options.output);
  const inputs = [source, options.background, options.subtitles].map((file) => path.resolve(file));
  const identity = (file: string): string =>
    fs.to_identity_path(fs.exists(file) ? fs.real_path(file) : file);
  if (inputs.some((file) => identity(file) === identity(output)))
    throw new Error("Output must not replace an input file.");
  await fs.make_dir_async(path.dirname(output));
  const release = await lockfile.lock(output, {
    realpath: false,
    retries: LOCK_RETRY,
  });
  let directory: string | undefined;
  try {
    const prefix = `.lg-visualize-${createHash("sha256").update(fs.to_identity_path(output)).digest("hex").slice(0, 16)}-`;
    // 前缀含输出路径哈希。持有输出锁时，同前缀目录只能是此前被强制终止的本输出残留。
    for (const entry of fs.read_dirents(path.dirname(output)))
      if (entry.isDirectory() && entry.name.startsWith(prefix))
        await fs.remove_async(path.join(path.dirname(output), entry.name), { recursive: true });
    // 临时目录与输出同目录，检查后的成片才能原子改名。
    directory = await fs.make_temp_dir(path.join(path.dirname(output), prefix));
    const job = path.join(directory, "job.json");
    await fs.write_file(
      job,
      JSON.stringify({
        source: inputs[0],
        background: inputs[1],
        subtitles: inputs[2],
        fonts: path.resolve(options.fonts),
        track: options.track,
        ffmpeg: ffmpeg_path(),
      }),
    );
    await execute(await python(), ["-I", "-X", "utf8", runtime_file("visualize.py"), job]);
    const temporary = path.join(directory, "result.mp4");
    const result = JSON.parse(fs.read_text_file(path.join(directory, "result.json"))) as Omit<
      VisualizeResult,
      "output"
    >;
    const checked = await inspect(temporary);
    if (
      checked.video?.width !== FRAME.width ||
      checked.video.height !== FRAME.height ||
      checked.audio.length !== 1 ||
      Math.abs(checked.duration - result.duration) > DURATION_TOLERANCE
    )
      throw new Error("Visualization output has an invalid picture, audio stream or duration.");
    fs.rename(temporary, output); // 同一文件系统原子替换，检查失败时旧成片仍在。
    return { ...result, output };
  } finally {
    try {
      if (directory) await fs.remove_async(directory, { recursive: true, force: true });
    } finally {
      await release();
    }
  }
}

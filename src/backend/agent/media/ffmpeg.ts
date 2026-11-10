import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import type { Readable } from "node:stream";
import { npm } from "../npm";

const STDERR_MAX_CHARS = 64 * 1024; // 只保留诊断尾部，避免长转码日志持续占用内存。
export const FFMPEG_PACKAGE = `ffmpeg-static-electron-v5-${process.platform}-${process.arch}`;

/**
 * 硬解候选：显存中按帧率取帧后再下载，避免回传被丢弃的帧。
 * 只有 Windows d3d11va 经过实测，其它平台不可用时校准自然选择软件解码。
 */
const HWACCELS: Readonly<Partial<Record<NodeJS.Platform, readonly (readonly [string, string])[]>>> =
  {
    win32: [["d3d11va", "d3d11"]],
    darwin: [["videotoolbox", "videotoolbox_vld"]],
    linux: [
      ["vaapi", "vaapi"],
      ["cuda", "cuda"],
    ],
  };

export type MediaInfo = {
  duration: number;
  video: { width: number; height: number } | null;
  audio: string[];
  subtitles: string[];
  streams: string[];
};
export type ExecuteOptions = Readonly<{
  check?: boolean; // 非零退出是否报错。
  consume?: (stdout: Readable) => Promise<void>;
  stdout?: "ignore" | "inherit";
}>;
/** Python 解码时插入的硬解参数。 */
export type Hwaccel = Readonly<{ name: string; input: readonly string[]; filter: string }>;

/** 外部工具共用日志与收尾，返回 stderr 尾部。工作区宿主负责停止进程树和控制超时。 */
export async function execute(
  binary: string,
  args: readonly string[],
  options: ExecuteOptions = {},
): Promise<string> {
  const { check = true, consume, stdout = "ignore" } = options;
  const child = spawn(binary, args, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", consume ? "pipe" : stdout, "pipe"],
  });
  let stderr = "",
    failure: Error | undefined;
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (text: string) => {
    stderr = (stderr + text).slice(-STDERR_MAX_CHARS);
  });
  const closed = new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => resolve(code));
  });
  try {
    if (consume) await consume(child.stdout!);
    const code = await closed;
    if (failure) throw new Error(`${path.basename(binary)} could not start.`, { cause: failure });
    if (code === null || (check && code !== 0))
      throw new Error(`${path.basename(binary)} failed (${code}): ${stderr}`);
    return stderr;
  } finally {
    // 消费输出失败时也等待原生进程退出，再允许调用者继续处理文件。
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}

/** 共享 npm 工程中随附 ffmpeg 的路径，Node 与 Python 两侧共用。 */
export function ffmpeg_path(): string {
  const binary = createRequire(path.join(npm.directory, "package.json"))(FFMPEG_PACKAGE) as {
    path: string;
  };
  return binary.path;
}

/** 截帧、提取字幕与转码共用二进制入口，参数直接传给 ffmpeg。 */
export function ffmpeg(args: readonly string[], options?: ExecuteOptions): Promise<string> {
  return execute(ffmpeg_path(), ["-hide_banner", "-nostdin", ...args], options);
}

/** 读取时间轴与流信息，封面图片不算视频画面。 */
export async function inspect(source: string): Promise<MediaInfo> {
  // 无输出目标时 ffmpeg 返回非零，仍须检查实际读出的媒体信息。
  const text = await ffmpeg(["-i", source], { check: false });
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(text);
  if (!duration) throw new Error("Cannot read media duration: " + text);
  const streams = text
    .split(/\r?\n/u)
    .filter((line) => /Stream #\d+:\d+/u.test(line))
    .map((line) => line.trim());
  const video = video_stream(streams);
  const size = video && /\b(\d{2,})x(\d{2,})\b/u.exec(video);
  if (video && !size) throw new Error("Cannot read video dimensions.");
  return {
    duration: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]),
    video: size ? { width: Number(size[1]), height: Number(size[2]) } : null,
    audio: streams.filter((line) => line.includes("Audio:")),
    subtitles: streams.filter((line) => line.includes("Subtitle:")),
    streams,
  };
}

/** 第一条真正的视频流，包含编码、像素格式与分辨率。 */
export function video_stream(streams: readonly string[]): string | undefined {
  return streams.find((line) => line.includes("Video:") && !line.includes("attached pic"));
}

/** 当前 ffmpeg 构建声明支持、且本平台有候选的硬解方式。下载格式按源位深选择。 */
export async function hwaccel_candidates(stream: string): Promise<Hwaccel[]> {
  let output = ""; // 列表写在 stdout。
  await ffmpeg(["-hwaccels"], {
    consume: async (stdout) => {
      for await (const chunk of stdout) output += String(chunk);
    },
  });
  const listed = new Set(output.split(/\s+/u));
  const deep = Number(/p(\d+)(?:le|be)\b/u.exec(stream)?.[1] ?? 8) > 8; // 如 yuv420p10le。
  return (HWACCELS[process.platform] ?? [])
    .filter(([name]) => listed.has(name))
    .map(([name, surface]) => ({
      name,
      input: ["-hwaccel", name, "-hwaccel_output_format", surface],
      filter: `hwdownload,format=${deep ? "p010le" : "nv12"}`,
    }));
}

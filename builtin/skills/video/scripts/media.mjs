import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { npm } from "@lg/npm";
import { MODELS, analyze, ready } from "./speech.mjs";

const MAX_SECONDS = 210; // 单个分段的时长上限。
const CUT_WINDOWS = [
  [180, 210],
  [120, 180],
]; // 优先靠近段尾切开，避免分段过短。
const CUT_GAP_SECONDS = 0.3; // 可以作为切点的最短无人声空隙。
const PACKAGE_MAX_BYTES = 900 * 1024 * 1024; // 包体积上限，超出时拆分原素材。
const STDERR_MAX_CHARS = 64 * 1024; // 只保留诊断尾部，避免长转码日志持续占用内存。
const DOWNLOAD_IDLE_SECONDS = 60; // 模型下载连续无数据的上限。
const CUSTOM_RENDERER = "render.mjs"; // 包内可选的定制渲染。
const ROW_KINDS = ["dialogue", "screen"]; // 对话与画面文字。
/** 模型读取的视频编码。分段与补查片段共用，保证两者的画面与音质一致。 */
export const ENCODE = Object.freeze([
  ...["-c:v", "libx264", "-crf", "30", "-preset", "medium", "-pix_fmt", "yuv420p"],
  ...["-c:a", "aac", "-b:a", "48k", "-ac", "1", "-movflags", "+faststart"],
]);

/** 第三方依赖装在共享 npm 工程，在用到时才加载，缺失时本文件仍可导入并检查。 */
const PACKAGES = Object.freeze({
  [`ffmpeg-static-electron-v5-${process.platform}-${process.arch}`]: "^5.2.5",
  "sherpa-onnx-node": "^2.0.1",
  jsonrepair: "^3.15.0",
  jszip: "^3.10.2",
});

export const load = async (file) => JSON.parse(await readFile(file, "utf8")); // 读取工作目录中的 JSON 材料。
export const prefix = (index) => String(index).padStart(3, "0"); // 分段文件名前缀。
const round = (value) => Number(value.toFixed(2)); // 切点统一精度。
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value); // 普通对象。

/** 只有缺失表示尚未生成，权限与其他 IO 错误保留。 */
export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** 原子发布 JSON，续跑只读取完整结果。 */
export async function save(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2));
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 列出尚未就绪的依赖与模型。包按共享 npm 工程中实际安装的目录判断，与工作区模块解析一致。 */
export async function missing() {
  const packages = [],
    models = [];
  for (const [name, range] of Object.entries(PACKAGES))
    if (!(await exists(path.join(npm.directory, "node_modules", name, "package.json"))))
      packages.push(`${name}@${range}`);
  for (const model of Object.values(MODELS)) if (!(await ready(model))) models.push(model);
  return { packages, models };
}

/**
 * 安装缺失的依赖并下载模型。模型边下载边校验，哈希一致才发布，中断不会留下可被误用的文件。
 * 实测连接可能不报错地停止传输，长时间收不到数据时中止，由调用者重新执行。
 */
export async function setup() {
  const { packages, models } = await missing();
  if (packages.length) await npm.run(["install", ...packages]);
  for (const model of models) {
    await mkdir(path.dirname(model.file), { recursive: true });
    const temporary = model.file + ".tmp";
    const hash = createHash("sha256");
    const controller = new AbortController();
    let timer;
    const idle = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          controller.abort(
            new Error(`下载 ${DOWNLOAD_IDLE_SECONDS} 秒没有进展，请重新调用 setup()`),
          ),
        DOWNLOAD_IDLE_SECONDS * 1000,
      );
    };
    try {
      idle();
      const response = await fetch(model.url, { signal: controller.signal });
      if (!response.ok || !response.body)
        throw new Error(`下载失败 (${response.status})：${model.url}`);
      await pipeline(
        Readable.fromWeb(response.body),
        new Transform({
          transform(chunk, _encoding, callback) {
            idle();
            hash.update(chunk);
            callback(null, chunk);
          },
        }),
        createWriteStream(temporary),
        { signal: controller.signal },
      );
      if (hash.digest("hex") !== model.sha256) throw new Error(`模型校验失败：${model.url}`);
      await rename(temporary, model.file);
    } finally {
      clearTimeout(timer);
      await rm(temporary, { force: true });
    }
  }
  return missing();
}

/** 唯一的 ffmpeg 进程入口。进程树的停止和超时归工作区宿主。 */
async function execute(args, { check = true, consume } = {}) {
  const { default: binary } = await import(
    `ffmpeg-static-electron-v5-${process.platform}-${process.arch}`
  );
  const child = spawn(binary.path, ["-hide_banner", "-nostdin", ...args], {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", consume ? "pipe" : "ignore", "pipe"],
  });
  let stderr = "",
    failure;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text) => {
    stderr = (stderr + text).slice(-STDERR_MAX_CHARS);
  });
  const closed = new Promise((resolve) => {
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => resolve(code));
  });
  try {
    if (consume) await consume(child.stdout);
    const code = await closed;
    if (failure) throw new Error("ffmpeg 启动失败", { cause: failure });
    if (code === null || (check && code !== 0)) throw new Error(`ffmpeg 失败 (${code})：${stderr}`);
    return stderr;
  } finally {
    // 消费 PCM 失败时也等待原生进程退出，再允许调用者继续处理文件。
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}

/** 截帧、提取字幕与转码共用二进制入口，参数直接传给 ffmpeg。 */
export async function ffmpeg(args) {
  await execute(args);
}

/** 读取时间轴与流信息，封面图片不算视频画面。 */
export async function inspect(source) {
  // 无输出目标时 ffmpeg 返回非零，仍须检查实际读出的媒体信息。
  const text = await execute(["-i", source], { check: false });
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(text);
  if (!duration) throw new Error("无法读取媒体时长：" + text);
  const streams = text
    .split(/\r?\n/u)
    .filter((line) => /Stream #\d+:\d+/u.test(line))
    .map((line) => line.trim());
  const video = streams.find((line) => line.includes("Video:") && !line.includes("attached pic"));
  const size = video && /\b(\d{2,})x(\d{2,})\b/u.exec(video);
  if (video && !size) throw new Error("无法读取原视频尺寸");
  return {
    duration: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]),
    video: size ? { width: Number(size[1]), height: Number(size[2]) } : null,
    audio: streams.filter((line) => line.includes("Audio:")),
    subtitles: streams.filter((line) => line.includes("Subtitle:")),
    streams,
  };
}

/**
 * 一次解码完成人声检测与本地识别。
 * 只选音轨时，部分容器会以音轨自身起点为零点；补齐起点并保留画面流，零点才与分段转码一致。
 */
async function listen(source, track, language) {
  let result;
  await execute(
    [
      "-v",
      "error",
      "-i",
      source,
      "-map",
      `0:a:${track}`,
      "-af",
      "aresample=first_pts=0",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "pipe:1",
      "-map",
      "0:V:0?",
      "-c",
      "copy",
      "-f",
      "null",
      "-",
    ],
    { consume: async (stream) => (result = await analyze(stream, language)) },
  );
  return result;
}

/** 在靠近段尾的无人声空隙中点切开，没有空隙时按上限硬切。音轨结束后的画面也算空隙。 */
function cuts(duration, voiced) {
  const gaps = [];
  if (voiced) {
    let previous = 0;
    for (const [start, end] of [...voiced, [duration, duration]]) {
      if (start > previous) gaps.push([previous, start]);
      previous = Math.max(previous, end);
    }
  }
  const points = [0];
  while (duration - points.at(-1) > MAX_SECONDS) {
    const from = points.at(-1);
    let cut = from + MAX_SECONDS;
    for (const [lower, upper] of CUT_WINDOWS) {
      let best;
      for (const gap of gaps) {
        // 跨越窗口边缘的长空隙按窗口内部分计算，不能因此错过停顿。
        const start = Math.max(gap[0], from + lower),
          end = Math.min(gap[1], from + upper);
        if (end - start >= CUT_GAP_SECONDS && (!best || end - start > best[1] - best[0]))
          best = [start, end];
      }
      if (best) {
        cut = (best[0] + best[1]) / 2;
        break;
      }
    }
    points.push(round(cut));
  }
  return [...points, duration];
}

/**
 * 导入：人声检测、本地识别、切段与转码。来源身份匹配后续用已发布的分段，转码成功才替换临时文件。
 * 本地识别结果随包保存，识别阶段不依赖导入时的工作目录。
 */
export async function prepare(source, directory, { track = 0, language } = {}) {
  source = path.resolve(source);
  const info = await inspect(source);
  if (!Number.isInteger(track) || track < 0 || (info.audio.length && track >= info.audio.length))
    throw new Error("音轨不存在");
  if (info.video === null && !info.audio.length) throw new Error("素材没有音视频流");
  const details = await stat(source, { bigint: true });
  // 纳秒用字符串保存，避免 JSON 数字丢失精度。
  const identity = {
    path: source,
    size: Number(details.size),
    mtime_ns: String(details.mtimeNs),
    track,
    language: language ?? null,
  };
  const identityFile = path.join(directory, "source.json");
  const manifestFile = path.join(directory, "video.json");
  if (await exists(identityFile)) {
    const previous = await load(identityFile);
    if (
      !record(previous) ||
      Object.entries(identity).some(([key, value]) => previous[key] !== value)
    )
      throw new Error("来源、音轨或语言已变化，请使用新的工作目录");
  } else {
    if (await exists(manifestFile)) throw new Error("工作目录缺少来源身份，请使用新的工作目录");
    await save(identityFile, identity);
  }
  if (!(await exists(manifestFile))) {
    // 已发布的切点决定响应的相对时间，之后不再因分析变化重切。
    const { speech, asr } = info.audio.length
      ? await listen(source, track, language)
      : { speech: null, asr: null };
    const points = cuts(info.duration, speech);
    await save(manifestFile, {
      video: info.video,
      speech,
      asr,
      segments: points
        .slice(0, -1)
        .map((start, i) => ({ path: `segments/${prefix(i)}.mp4`, start, end: points[i + 1] })),
    });
  }
  const manifest = await load(manifestFile);
  for (const [i, segment] of manifest.segments.entries()) {
    const target = path.join(directory, segment.path);
    if (await exists(target)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = target + ".tmp.mp4";
    const args = ["-v", "error", "-y", "-ss", String(segment.start), "-i", source];
    if (manifest.video === null)
      args.push("-f", "lavfi", "-i", "color=c=black:s=256x144:r=1", "-map", "1:v:0");
    else
      args.push(
        "-map",
        "0:V:0",
        "-vf",
        "fps=1,scale=w='min(1024,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      );
    if (info.audio.length) args.push("-map", `0:a:${track}`);
    if (manifest.video === null) args.push("-shortest");
    args.push("-t", String(segment.end - segment.start), ...ENCODE, temporary);
    try {
      await ffmpeg(args);
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    console.log(`转码 ${i + 1}/${manifest.segments.length}`);
  }
  return {
    segments: manifest.segments.length,
    speech: manifest.speech?.length ?? null,
    asr: manifest.asr?.length ?? null,
  };
}

/** 字幕行的结构与时间是否可用。坏时间不能参与排序和区间运算，姓名须符合后端记录契约。 */
export function valid_row(row, duration) {
  return (
    record(row) &&
    Number.isFinite(row.start) &&
    Number.isFinite(row.end) &&
    0 <= row.start &&
    row.start < row.end &&
    row.end <= duration &&
    ROW_KINDS.includes(row.kind) &&
    typeof row.src === "string" &&
    row.src.trim() !== "" &&
    typeof row.dst === "string" &&
    (row.name === undefined || typeof row.name === "string")
  );
}

/**
 * 校验字幕草稿并打包。`rows.json` 全部合法才写出 `items.json`，原文进包，译文写入 `translations.json` 供提交使用。
 * 没有草稿时沿用已有的 `items.json`，导入阶段为空记录。失败时保留已有完整包。
 */
export async function pack(directory, output) {
  const { default: JSZip } = await import("jszip");
  const manifest = await load(path.join(directory, "video.json"));
  const rowsFile = path.join(directory, "rows.json"),
    itemsFile = path.join(directory, "items.json");
  if (await exists(rowsFile)) {
    const rows = await load(rowsFile);
    if (!Array.isArray(rows)) throw new Error("rows.json 必须是数组");
    const duration = manifest.segments.at(-1).end;
    const invalid = rows.findIndex((row) => !valid_row(row, duration));
    if (invalid !== -1)
      throw new Error(`rows.json 第 ${invalid} 行不合法：${JSON.stringify(rows[invalid])}`);
    const sorted = [...rows].sort((a, b) => a.start - b.start);
    await save(
      itemsFile,
      sorted.map(({ src, dst: _dst, ...row }) => ({ ...row, message: src })),
    );
    await save(
      path.join(directory, "translations.json"),
      sorted.map(({ src, dst }, row_number) => ({ row_number, src, dst })),
    );
  } else if (!(await exists(itemsFile))) await save(itemsFile, []);
  const items = await load(itemsFile);
  const members = ["video.json", "items.json", ...manifest.segments.map((segment) => segment.path)];
  if (await exists(path.join(directory, CUSTOM_RENDERER))) members.push(CUSTOM_RENDERER);
  const zip = new JSZip(),
    inputs = [];
  for (const member of members) {
    // 每次消费才打开文件，分段多时也不同时占用全部文件句柄。
    const input = Readable.from(
      (async function* () {
        yield* createReadStream(path.join(directory, member));
      })(),
    );
    inputs.push(input);
    zip.file(member, input);
  }
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = output + ".tmp.video";
  try {
    await pipeline(
      zip.generateNodeStream({ streamFiles: true, compression: "STORE" }),
      async function* (chunks) {
        let bytes = 0;
        for await (const chunk of chunks) {
          bytes += chunk.length;
          if (bytes > PACKAGE_MAX_BYTES) throw new Error("包超过 900 MiB，请拆分原素材后导入");
          yield chunk;
        }
      },
      createWriteStream(temporary),
    );
    await rename(temporary, output);
  } finally {
    // 主错误由 pipeline 报告。销毁未消费的输入会产生预期的提前关闭错误。
    await Promise.allSettled(
      inputs.map((input) => {
        input.destroy();
        return finished(input);
      }),
    );
    await rm(temporary, { force: true });
  }
  return { package: output, items: items.length };
}

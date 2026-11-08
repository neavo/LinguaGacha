import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { npm } from "@lg/npm";

const MAX_SECONDS = 210; // 单个分段的时长上限。
const CUT_WINDOWS = [
  [180, 210],
  [120, 180],
]; // 优先靠近段尾切开，避免分段过短。
const CUT_GAP_SECONDS = 0.3; // 可以作为切点的最短无人声空隙。
const UNCOVERED_SECONDS = 0.3; // 报告的最短未覆盖人声。门槛越长，短句漏识别越难发现。
const SAMPLE_RATE = 16000; // Silero 的输入采样率。
const VAD_FRAME = 512; // sherpa 每次调用只合并判断一次，必须逐帧送入。
const VAD_BUFFER_SECONDS = 90; // 须大于 maxSpeechDuration。
// Silero 参数是漏句检出与复核量的实测折中，调整后需重新评估。
const VAD = Object.freeze({
  threshold: 0.3,
  minSilenceDuration: 0.1,
  minSpeechDuration: 0.1,
  windowSize: VAD_FRAME,
  maxSpeechDuration: 60,
});
const PACKAGE_MAX_BYTES = 900 * 1024 * 1024; // 包体积上限，超出时拆分原素材。
const STDERR_MAX_CHARS = 64 * 1024; // 只保留诊断尾部，避免长转码日志持续占用内存。
const CUSTOM_RENDERER = "render.mjs"; // 包内可选的定制渲染。
const ROW_KINDS = ["dialogue", "screen"]; // 对话与画面文字。

/** 第三方依赖装在共享 npm 工程，在用到时才加载，缺失时本文件仍可导入并检查。 */
const PACKAGES = Object.freeze({
  [`ffmpeg-static-electron-v5-${process.platform}-${process.arch}`]: "^5.2.5",
  "sherpa-onnx-node": "^2.0.1",
  jsonrepair: "^3.15.0",
  jszip: "^3.10.2",
});

/** 固定版本的 Silero VAD 模型，所有工程共用。共享 npm 工程固定为 userdata/node，据此定位 userdata/models。 */
const SPEECH_MODEL = Object.freeze({
  file: path.resolve(npm.directory, "..", "models", "silero_vad", "v6.2.3.onnx"),
  url: "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx",
  sha256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
});

export const load = async (file) => JSON.parse(await readFile(file, "utf8")); // 读取工作目录中的 JSON 材料。
export const prefix = (index) => String(index).padStart(3, "0"); // 分段文件名前缀。
const round = (value, places) => Number(value.toFixed(places)); // 时间写入前统一精度。
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

/** 模型存在且与固定版本一致。sherpa 加载缺失或损坏的模型时不报错，只会静默得到空结果。 */
async function model_ready() {
  try {
    const bytes = await readFile(SPEECH_MODEL.file);
    return createHash("sha256").update(bytes).digest("hex") === SPEECH_MODEL.sha256;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** 列出尚未就绪的依赖与模型。包按共享 npm 工程中实际安装的目录判断，与工作区模块解析一致。 */
export async function missing() {
  const packages = [];
  for (const [name, range] of Object.entries(PACKAGES))
    if (!(await exists(path.join(npm.directory, "node_modules", name, "package.json"))))
      packages.push(`${name}@${range}`);
  return { packages, model: (await model_ready()) ? null : SPEECH_MODEL };
}

/** 字幕行的结构与时间是否可用。坏时间不能参与排序和区间运算。 */
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
    typeof row.dst === "string"
  );
}

/** 排序并合并相接或重叠的区间。 */
function union(spans) {
  const result = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}

/** 从有序区间中扣除另一组有序且不重叠的区间。 */
function subtract(spans, cover) {
  const result = [];
  for (let [start, end] of spans) {
    for (const [a, b] of cover) {
      if (b <= start || a >= end) continue;
      if (a > start) result.push([start, a]);
      start = b;
    }
    if (end > start) result.push([start, end]);
  }
  return result;
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
 * 整片人声区间，单位为整片秒数。
 * 只选音轨时，部分容器会以音轨自身起点为零点；补齐起点并保留画面流，零点才与分段转码一致。
 */
async function speech(source, track) {
  if (!(await model_ready())) throw new Error("人声模型缺失或不一致，先按 media.missing() 补齐");
  const { default: sherpa } = await import("sherpa-onnx-node");
  const vad = new sherpa.Vad(
    {
      sileroVad: { model: SPEECH_MODEL.file, ...VAD },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: "cpu",
      debug: 0,
    },
    VAD_BUFFER_SECONDS,
  );
  const spans = [];
  // 及时取出已完成的人声区间，检测器不再积累音频样本。
  const drain = () => {
    for (; !vad.isEmpty(); vad.pop()) {
      const { start, samples } = vad.front(false); // Electron 不支持外部 ArrayBuffer。
      spans.push([start / SAMPLE_RATE, (start + samples.length) / SAMPLE_RATE]);
    }
  };
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
      String(SAMPLE_RATE),
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
    {
      consume: async (stream) => {
        const frame = new Float32Array(VAD_FRAME);
        let filled = 0,
          low; // 跨数据块保留尚未配对的低字节。
        for await (const chunk of stream) {
          for (const byte of chunk) {
            if (low === undefined) {
              low = byte;
              continue;
            }
            frame[filled++] = (((byte << 24) >> 16) | low) / 32768; // 小端 s16，高字节带符号。
            low = undefined;
            if (filled === VAD_FRAME) {
              vad.acceptWaveform(frame);
              drain();
              filled = 0;
            }
          }
        }
        if (low !== undefined) throw new Error("PCM 采样不完整");
        if (filled) vad.acceptWaveform(frame.slice(0, filled));
        vad.flush();
        drain();
      },
    },
  );
  // 模型会按 maxSpeechDuration 拆开长语音，相接的区间不是停顿。
  return union(spans).map(([start, end]) => [round(start, 2), round(end, 2)]);
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
    points.push(round(cut, 2));
  }
  return [...points, duration];
}

/** 来源身份匹配后续用已发布的分段，转码成功才替换临时文件。 */
export async function prepare(source, directory, { track = 0 } = {}) {
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
  };
  const identityFile = path.join(directory, "source.json");
  const manifestFile = path.join(directory, "video.json");
  if (await exists(identityFile)) {
    const previous = await load(identityFile);
    if (
      !record(previous) ||
      Object.entries(identity).some(([key, value]) => previous[key] !== value)
    )
      throw new Error("来源或音轨已变化，请使用新的工作目录");
  } else {
    if (await exists(manifestFile)) throw new Error("工作目录缺少来源身份，请使用新的工作目录");
    await save(identityFile, identity);
  }
  if (!(await exists(manifestFile))) {
    // 已发布的切点决定响应的相对时间，之后不再因分析变化重切。
    const voiced = info.audio.length ? await speech(source, track) : null;
    const points = cuts(info.duration, voiced);
    await save(manifestFile, {
      video: info.video,
      speech: voiced,
      segments: points
        .slice(0, -1)
        .map((start, i) => ({ path: `segments/${prefix(i)}.mp4`, start, end: points[i + 1] })),
    });
  }
  const itemsFile = path.join(directory, "items.json");
  if (!(await exists(itemsFile))) await save(itemsFile, []);
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
    if (info.audio.length)
      args.push("-map", `0:a:${track}`, "-c:a", "aac", "-b:a", "48k", "-ac", "1");
    if (manifest.video === null) args.push("-shortest");
    args.push(
      "-t",
      String(segment.end - segment.start),
      "-c:v",
      "libx264",
      "-crf",
      "30",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      temporary,
    );
    try {
      await ffmpeg(args);
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    console.log(`转码 ${i + 1}/${manifest.segments.length}`);
  }
  return manifest;
}

/** 人声与对话行的对照，只是证据，不判断字幕对错。无音轨时为 null。 */
function evidence(voiced, segment, rows, duration) {
  if (voiced === null) return { uncovered_speech: null, unsupported_dialogue: null };
  const dialogue = rows.flatMap((row, index) =>
    valid_row(row, duration) && row.kind === "dialogue"
      ? [{ index, start: row.start, end: row.end }]
      : [],
  );
  const inside = voiced.flatMap(([start, end]) =>
    end > segment.start && start < segment.end
      ? [[Math.max(start, segment.start), Math.min(end, segment.end)]]
      : [],
  );
  return {
    uncovered_speech: subtract(inside, union(dialogue.map(({ start, end }) => [start, end])))
      .filter(([start, end]) => end - start >= UNCOVERED_SECONDS)
      .map(([start, end]) => [round(start, 2), round(end, 2)]),
    unsupported_dialogue: dialogue
      .filter((row) => !voiced.some(([start, end]) => start < row.end && end > row.start))
      .map(({ index }) => index),
  };
}

/** 响应时间换算为整片时间，已有修正行拥有优先权。每次按当前行重新质控。 */
export async function parse(directory) {
  const { jsonrepair, JSONRepairError } = await import("jsonrepair");
  const { speech: voiced, segments } = await load(path.join(directory, "video.json"));
  const duration = segments.at(-1).end;
  const summary = [];
  for (const [i, segment] of segments.entries()) {
    const responseFile = path.join(directory, `${prefix(i)}.response.json`);
    const rowsFile = path.join(directory, `${prefix(i)}.rows.json`);
    const hasResponse = await exists(responseFile),
      hasRows = await exists(rowsFile);
    if (!hasResponse && !hasRows) {
      summary.push({ index: i, missing: true });
      continue;
    }
    const savedResponse = hasResponse ? await load(responseFile) : {};
    const response =
      savedResponse.response?.format === "responses"
        ? (savedResponse.response.raw ?? {})
        : savedResponse;
    const text = (response.output ?? [])
      .flatMap((entry) => entry.content ?? [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("\n");
    let rows = [];
    const invalid = [];
    for (const line of text.split(/\r?\n/u)) {
      const text = line.trim();
      if (!text || text.startsWith("```")) continue;
      let row;
      try {
        row = JSON.parse(jsonrepair(text));
      } catch (error) {
        if (!(error instanceof JSONRepairError || error instanceof SyntaxError)) throw error;
        invalid.push(text); // 单行模型输出损坏只进入质控摘要。
        continue;
      }
      if (record(row) && Number.isFinite(row.start) && Number.isFinite(row.end))
        rows.push({
          ...row,
          start: round(row.start + segment.start, 3),
          end: round(row.end + segment.start, 3),
        });
      else invalid.push(text);
    }
    if (hasRows) rows = await load(rowsFile);
    else await save(rowsFile, rows);
    summary.push({
      index: i,
      start: segment.start,
      end: segment.end,
      rows: rows.length,
      incomplete:
        hasResponse && (response.status !== "completed" || Boolean(response.incomplete_details)),
      invalid_lines: invalid,
      invalid_rows: rows.flatMap((row, index) => (valid_row(row, duration) ? [] : [index])),
      ...evidence(voiced, segment, rows, duration),
    });
  }
  return summary;
}

/** 校验并合并字幕，原文进包，译文留作工程提交材料。 */
export async function items(directory) {
  const { segments } = await load(path.join(directory, "video.json"));
  const duration = segments.at(-1).end;
  const rows = [];
  for (const i of segments.keys()) {
    const file = path.join(directory, `${prefix(i)}.rows.json`);
    if (!(await exists(file))) throw new Error(`分段 ${i} 尚无识别结果`);
    for (const [index, row] of (await load(file)).entries()) {
      if (!valid_row(row, duration))
        throw new Error(`分段 ${i} 第 ${index} 行不合法：${JSON.stringify(row)}`);
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.start - b.start);
  await save(
    path.join(directory, "items.json"),
    rows.map(({ src, dst: _dst, ...row }) => ({ ...row, message: src })),
  );
  await save(
    path.join(directory, "translations.json"),
    rows.map(({ src, dst }, row_number) => ({ row_number, src, dst })),
  );
  return { items: rows.length };
}

/** 只打包清单指定的交付材料，失败时保留已有完整包。 */
export async function pack(directory, output) {
  const { default: JSZip } = await import("jszip");
  const manifest = await load(path.join(directory, "video.json"));
  await load(path.join(directory, "items.json"));
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
  return { package: output, members: members.length };
}

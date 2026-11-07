import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import JSZip from "jszip";
import { jsonrepair, JSONRepairError } from "jsonrepair";

const MAX_SECONDS = 210;
const HOP_SECONDS = 0.1;
const SAMPLE_RATE = 16000;
const HOP_SAMPLES = SAMPLE_RATE * HOP_SECONDS;
const SAMPLE_SCALE = 32768;
const SILENCE_DB = -40;
const MIN_PAUSE = 3; // 100ms 格数。
const CUT_WINDOWS = [
  [180, 210],
  [120, 180],
];
const UNCOVERED_SECONDS = 5;
const PACKAGE_MAX_BYTES = 900 * 1024 * 1024;
const STDERR_MAX_CHARS = 64 * 1024; // 只保留诊断尾部，避免长转码日志持续占用内存。
const CUSTOM_RENDERER = "render.mjs";

const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const round = (value, places) => Number(value.toFixed(places));
const prefix = (index) => String(index).padStart(3, "0");
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** 只有缺失表示尚未生成，权限与其他 IO 错误保留。 */
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** 原子发布 JSON，续跑只读取完整结果。 */
async function save(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2));
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 安装归技能准备步骤。进程树的停止和超时归工作区宿主。 */
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

/** 只保留每 100ms 的能量，PCM 的采样和窗口边界可以跨 stdout 数据块。 */
async function energy(source, track) {
  const values = [];
  await execute(
    [
      "-v",
      "error",
      "-i",
      source,
      "-map",
      `0:a:${track}`,
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "s16le",
      "pipe:1",
    ],
    {
      consume: async (stream) => {
        let byte, // 跨数据块保留尚未配对的低字节。
          samples = 0,
          sum = 0;
        const append = () => {
          values.push(20 * Math.log10(Math.max(Math.sqrt(sum / HOP_SAMPLES), 1e-6)));
          samples = 0;
          sum = 0;
        };
        for await (const chunk of stream) {
          for (const value of chunk) {
            if (byte === undefined) {
              byte = value;
              continue;
            }
            const unsigned = byte | (value << 8);
            const sample =
              (unsigned >= SAMPLE_SCALE ? unsigned - SAMPLE_SCALE * 2 : unsigned) / SAMPLE_SCALE;
            byte = undefined;
            sum += sample * sample;
            if (++samples === HOP_SAMPLES) append();
          }
        }
        if (byte !== undefined) throw new Error("PCM 采样不完整");
        if (samples) append(); // 尾窗口按补零计算，保持与完整窗口相同的分母。
      },
    },
  );
  return values;
}

/** 优先在靠近段尾的停顿切开，无停顿时选择低能量点。 */
function cuts(duration, db) {
  const result = [0];
  while (duration - result.at(-1) > MAX_SECONDS) {
    const start = Math.round(result.at(-1) / HOP_SECONDS);
    let cut;
    if (db) {
      for (const [lower, upper] of CUT_WINDOWS) {
        let best = 0,
          middle = 0,
          run = 0;
        for (
          let i = start + lower / HOP_SECONDS;
          i < Math.min(start + upper / HOP_SECONDS, db.length);
          i++
        ) {
          run = db[i] < SILENCE_DB ? run + 1 : 0;
          if (run > best) {
            best = run;
            middle = i - run + 1 + Math.floor(run / 2);
          }
        }
        if (best >= MIN_PAUSE) {
          cut = middle * HOP_SECONDS;
          break;
        }
      }
      if (cut === undefined) {
        const lo = start + CUT_WINDOWS[1][0] / HOP_SECONDS;
        const hi = Math.min(start + MAX_SECONDS / HOP_SECONDS, db.length);
        if (hi > lo) {
          let best = lo;
          for (let i = lo + 1; i < hi; i++) if (db[i] < db[best]) best = i;
          cut = best * HOP_SECONDS;
        }
      }
    }
    result.push(round(cut ?? result.at(-1) + MAX_SECONDS, 2));
  }
  return [...result, duration];
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
      throw new Error("来源、音轨或续跑身份格式已变化，请使用新的工作目录");
  } else {
    if (await exists(manifestFile)) throw new Error("工作目录缺少来源身份，请使用新的工作目录");
    await save(identityFile, identity);
  }
  if (!(await exists(manifestFile))) {
    const points = cuts(info.duration, info.audio.length ? await energy(source, track) : null);
    await save(manifestFile, {
      video: info.video,
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

/** 从有声区间扣除对话覆盖，音乐与音效仍计入剩余区间。 */
async function uncovered_voice(file, segment, rows) {
  if (!(await inspect(file)).audio.length) return [];
  const voiced = (await energy(file, 0)).map((db) => db >= SILENCE_DB);
  for (const row of rows) {
    if (row.kind === "dialogue" && Number.isFinite(row.start) && Number.isFinite(row.end)) {
      const first = Math.max(0, Math.trunc((row.start - segment.start) / HOP_SECONDS));
      voiced.fill(
        false,
        first,
        Math.max(first, Math.ceil((row.end - segment.start) / HOP_SECONDS)),
      );
    }
  }
  const spans = [];
  let begin;
  for (let i = 0; i <= voiced.length; i++) {
    if (voiced[i] && begin === undefined) begin = i;
    else if (!voiced[i] && begin !== undefined) {
      if ((i - begin) * HOP_SECONDS >= UNCOVERED_SECONDS)
        spans.push([
          round(segment.start + begin * HOP_SECONDS, 1),
          round(segment.start + i * HOP_SECONDS, 1),
        ]);
      begin = undefined;
    }
  }
  return spans;
}

/** 响应时间换算为整片时间，已有修正行拥有优先权。 */
export async function parse(directory) {
  const summary = [];
  for (const [i, segment] of (await load(path.join(directory, "video.json"))).segments.entries()) {
    const responseFile = path.join(directory, `${prefix(i)}.response.json`);
    const rowsFile = path.join(directory, `${prefix(i)}.rows.json`);
    const hasResponse = await exists(responseFile),
      hasRows = await exists(rowsFile);
    if (!hasResponse && !hasRows) {
      summary.push({ index: i, missing: true });
      continue;
    }
    const response = hasResponse ? await load(responseFile) : {};
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
      uncovered_voice: await uncovered_voice(path.join(directory, segment.path), segment, rows),
    });
  }
  return summary;
}

/** 校验并合并字幕，原文进包，译文留作工程提交材料。 */
export async function items(directory) {
  const { segments } = await load(path.join(directory, "video.json"));
  const rows = [];
  for (const i of segments.keys()) {
    const file = path.join(directory, `${prefix(i)}.rows.json`);
    if (!(await exists(file))) throw new Error(`分段 ${i} 尚无识别结果`);
    rows.push(...(await load(file)));
  }
  for (const [i, row] of rows.entries()) {
    if (
      !record(row) ||
      !(
        Number.isFinite(row.start) &&
        Number.isFinite(row.end) &&
        0 <= row.start &&
        row.start < row.end &&
        row.end <= segments.at(-1).end
      ) ||
      !["dialogue", "screen"].includes(row.kind) ||
      typeof row.src !== "string" ||
      !row.src.trim() ||
      typeof row.dst !== "string"
    )
      throw new Error(`第 ${i} 行不合法：${JSON.stringify(row)}`);
  }
  rows.sort((a, b) => a.start - b.start); // 校验后排序，坏时间不能参与比较。
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

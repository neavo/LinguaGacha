import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, install, load, locate, save, valid_row } from "./media.mjs";
import { union } from "@lg/media";

const MAX_SECONDS = 210; // 单个补查区间的时长上限，更长时模型常常空输出或截断。
const MEDIA_INPUT_MAX_BYTES = 50_000_000; // 先限制原始字节，避免超大片段继续分配 Base64 和 JSON。
const MEDIA_REQUEST_MAX_BYTES = 64_000_000; // 与批量请求入口的 JSON 大小上限一致。
const UNCOVERED_MIN_SECONDS = 1; // 过滤人声与对白边缘的小缝，与 ASR 并入短句的 1 秒门槛一致。
const round = (value) => Number(value.toFixed(3)); // 换算后的时间精度。
/** 模型读取的视频编码：每秒一帧、长边 1024，单声道低码率音频。 */
const ENCODE = Object.freeze([
  "-c:v",
  "libx264",
  "-crf",
  "28",
  "-preset",
  "medium",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "48k",
  "-ac",
  "1",
  "-movflags",
  "+faststart",
]);

/** 请求 ID 即整片时间区间，结果回来时据此换算坐标，不需要另存映射。 */
const range_id = ({ start, end }) => `${start}-${end}`;
const same = (a, b) => a.start === b.start && a.end === b.end; // 区间相同。
const inside = (row, { start, end }) => start <= row.start && row.start < end; // 记录按起点归属区间。

/**
 * 视频模型补查 ASR 解决不了的区间。为整片时间区间从原文件裁出片段，写出统一消息请求清单。
 * 区间与次数由用户确认，不设预算。
 */
export async function request(directory, { prompt, ranges }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("必须提供识别提示词");
  if (!Array.isArray(ranges) || !ranges.length) throw new Error("必须指定补查区间");
  const root = path.resolve(directory);
  const { duration, video, source } = await load(path.join(root, "media.json"));
  const file = await locate(root);
  const planned = new Map(); // 相同区间只生成一份载荷。
  for (const range of ranges) {
    const { start, end } = range;
    if (
      !(Number.isFinite(start) && Number.isFinite(end)) ||
      start < 0 ||
      end > duration ||
      !(start < end && end - start <= MAX_SECONDS)
    )
      throw new Error(`区间 ${JSON.stringify(range)} 无效或超过 ${MAX_SECONDS} 秒`);
    planned.set(range_id(range), { start, end });
  }
  await mkdir(path.join(root, "recognition"), { recursive: true });
  const attempt = await mkdtemp(path.join(root, "recognition", "prepare-")); // 每次准备独占目录，重试不覆盖上次的请求与结果。
  const requests = [];
  for (const [id, { start, end }] of planned) {
    const clip = path.join(attempt, `${requests.length}.mp4`);
    const args = ["-v", "error", "-y", "-ss", String(start), "-t", String(end - start)];
    args.push("-i", file);
    // 纯音频补黑画面，让只接受视频输入的模型也能听取声音。
    if (video === null)
      args.push("-f", "lavfi", "-i", "color=c=black:s=256x144:r=1", "-map", "1:v:0", "-shortest");
    else
      args.push(
        "-map",
        "0:V:0",
        "-vf",
        "fps=1,scale=w='min(1024,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      );
    args.push("-map", `0:a:${source.track}?`, ...ENCODE, clip);
    await ffmpeg(args);
    const bytes = await readFile(clip);
    await rm(clip);
    if (bytes.length === 0 || bytes.length >= MEDIA_INPUT_MAX_BYTES)
      throw new Error("媒体片段必须非空且小于 50 MB");
    const body = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "video",
              mime_type: "video/mp4",
              data: bytes.toString("base64"),
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
    if (Buffer.byteLength(body) > MEDIA_REQUEST_MAX_BYTES)
      throw new Error("媒体请求超过 64 MB，请缩小区间");
    const input_file = `${requests.length}.request.json`;
    await writeFile(path.join(attempt, input_file), body);
    requests.push({ id, input_file });
  }
  const request_file = path.join(attempt, "requests.json");
  await save(request_file, { format: "messages", requests });
  return { requested: requests.length, request_file };
}

/**
 * 解析批量结果，模型的相对时间加区间起点换算为整片时间，只接受 `dialogue` 行。
 * 结果写入独立候选文件，由 `apply` 采用。失败项只列出，已有原文继续保留。
 */
export async function read(directory, result_file) {
  await install("jsonrepair", "^3.15.0");
  const { jsonrepair, JSONRepairError } = await import("jsonrepair");
  const root = path.resolve(directory);
  const result = await load(result_file);
  const ranges = [],
    failed = [];
  for (const entry of result.requests) {
    const [start, end] = entry.id.split("-").map(Number);
    if (!(Number.isFinite(start) && Number.isFinite(end)))
      throw new Error(`无效的请求 ID：${entry.id}`);
    const saved =
      entry.status === "succeeded" && entry.result_file
        ? await load(path.resolve(path.dirname(result_file), entry.result_file))
        : null;
    const response =
      saved?.status === "succeeded" && saved.response?.format === "messages"
        ? saved.response
        : null;
    if (!response) {
      failed.push({ start, end });
      continue;
    }
    const text = response.text;
    const rows = [],
      invalid_lines = [];
    for (const line of text.split(/\r?\n/u)) {
      const content = line.trim();
      if (!content || content.startsWith("```")) continue;
      let row;
      try {
        row = JSON.parse(jsonrepair(content));
      } catch (error) {
        if (!(error instanceof JSONRepairError || error instanceof SyntaxError)) throw error;
        invalid_lines.push(content); // 单行模型输出损坏只进入摘要。
        continue;
      }
      if (valid_row(row, end - start) && row.kind === "dialogue")
        rows.push({
          ...row,
          start: round(row.start + start),
          end: round(row.end + start),
        });
      else invalid_lines.push(content);
    }
    ranges.push({
      start,
      end,
      invalid_lines,
      rows,
    });
  }
  // 候选按结果目录命名，多批结果各自保留，由 `apply` 选择采用哪一批。
  const candidate = path.join(
    root,
    "recognition",
    `${path.basename(path.dirname(result_file))}.json`,
  );
  await save(candidate, ranges);
  return {
    candidate,
    ranges: ranges.map(({ rows, invalid_lines, ...range }) => ({
      ...range,
      rows: rows.length,
      invalid_lines: invalid_lines.length,
    })),
    failed,
  };
}

/**
 * 用候选替换 `items.json` 中指定区间的 `dialogue` 记录，再按起点稳定排序。
 * 区间内的 `screen` 来自本地流程，保持不变。
 */
export async function apply(directory, candidate, ranges) {
  const itemsFile = path.join(path.resolve(directory), "items.json");
  let items = await load(itemsFile);
  const adopted = (await load(candidate)).filter((range) =>
    ranges.some((wanted) => same(wanted, range)),
  );
  if (adopted.length !== ranges.length) throw new Error("ranges 中有候选文件不存在的区间");
  // 截断由请求入口列为失败项。采用前检查整批候选，避免空输出抹掉已有对白。
  if (adopted.some((range) => !range.rows.length))
    throw new Error("候选包含空输出，只传入非空的区间");
  for (const range of adopted)
    items = [
      ...items.filter((row) => row.kind !== "dialogue" || !inside(row, range)),
      ...range.rows,
    ];
  items.sort((a, b) => a.start - b.start);
  await save(itemsFile, items);
  return {
    adopted: adopted.map(({ start, end }) => ({ start, end })),
    items: items.length,
  };
}

/** 区间与一组已合并区间的重叠时长。 */
const covered = ([start, end], cover) =>
  cover.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(end, b) - Math.max(start, a)), 0);

/** 区间去掉一组已合并区间后剩下的部分。 */
function subtract([start, end], cover) {
  const rest = [];
  let cursor = start;
  for (const [a, b] of cover) {
    if (b <= cursor) continue;
    if (a >= end) break;
    if (a > cursor) rest.push([cursor, a]);
    cursor = b;
  }
  if (cursor < end) rest.push([cursor, end]);
  return rest;
}

/**
 * 字幕原文与本地证据的对照，只提供线索，不判断字幕对错。无音轨时两项线索为 `null`。
 * `uncovered` 按 token 起点归属 ASR 句子。相邻句的句尾留白可能伸进缺口，
 * 按整句时间归属会把 ASR 没出字的缺口误标为已有识别文字。
 */
export async function check(directory) {
  const root = path.resolve(directory);
  const { duration, speech, asr } = await load(path.join(root, "media.json"));
  const rows = await load(path.join(root, "items.json"));
  const dialogue = rows.flatMap((row, index) =>
    valid_row(row, duration) && row.kind === "dialogue"
      ? [{ index, span: [row.start, row.end] }]
      : [],
  );
  const cover = union(dialogue.map(({ span }) => span));
  return {
    invalid_rows: rows.flatMap((row, index) => (valid_row(row, duration) ? [] : [index])),
    uncovered:
      speech &&
      speech
        .flatMap((span) => subtract(span, cover))
        .filter(([start, end]) => end - start >= UNCOVERED_MIN_SECONDS)
        .map(([start, end]) => ({
          start,
          end,
          asr: asr
            .filter(({ tokens }) => tokens.some(([, at]) => start <= at && at < end))
            .map(({ text }) => text)
            .join(" "),
        })),
    unsupported:
      speech &&
      dialogue.filter(({ span }) => covered(span, speech) === 0).map(({ index }) => index),
  };
}

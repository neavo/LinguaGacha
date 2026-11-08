import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENCODE, exists, ffmpeg, load, save, valid_row } from "./media.mjs";
import { union } from "./speech.mjs";

const VIDEO_INPUT_MAX_BYTES = 50_000_000; // 单个视频输入的接口上限。
const VIDEO_REQUEST_MAX_BYTES = 64_000_000; // 单个请求体的接口上限。
const UNCOVERED_SECONDS = 0.3; // 只有人声区间时报告的最短未覆盖人声。
const UNCOVERED_RATIO = 0.5; // 本地识别窗口被对白覆盖不足该比例时报告。
const round = (value) => Number(value.toFixed(3)); // 换算后的时间精度。

/** 请求 ID 即整片时间区间，结果回来时据此换算坐标，不需要另存映射。 */
const range_id = ({ start, end }) => `${start}-${end}`;

/**
 * 为整片时间区间准备 `responses` 载荷，不指定 `ranges` 时请求全部分段。
 * 区间等于分段时直接使用分段；更小的区间从所在分段裁出，须位于同一分段内。
 */
export async function request(directory, { prompt, ranges }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("必须提供识别提示词");
  const root = path.resolve(directory);
  const { segments } = await load(path.join(root, "video.json"));
  await mkdir(path.join(root, "recognition"), { recursive: true });
  const attempt = await mkdtemp(path.join(root, "recognition", "prepare-"));
  const requests = new Map();
  for (const range of ranges ?? segments) {
    const { start, end } = range;
    const segment = segments.find((item) => item.start <= start && end <= item.end);
    if (!(Number.isFinite(start) && Number.isFinite(end) && start < end) || !segment)
      throw new Error(`区间 ${JSON.stringify(range)} 无效或跨越分段`);
    const id = range_id({ start, end });
    if (requests.has(id)) continue;
    let file = path.join(root, segment.path);
    if (start !== segment.start || end !== segment.end) {
      file = path.join(attempt, `${requests.size}.mp4`);
      await ffmpeg([
        "-v",
        "error",
        "-y",
        "-ss",
        String(start - segment.start),
        "-i",
        path.join(root, segment.path),
        "-t",
        String(end - start),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        ...ENCODE,
        file,
      ]);
    }
    const bytes = await readFile(file);
    if (bytes.length === 0 || bytes.length >= VIDEO_INPUT_MAX_BYTES)
      throw new Error("视频片段必须非空且小于 50 MB");
    const body = JSON.stringify({
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_video",
              video_url: `data:video/mp4;base64,${bytes.toString("base64")}`,
              fps: 1,
            },
            { type: "input_text", text: prompt },
          ],
        },
      ],
    });
    if (Buffer.byteLength(body) > VIDEO_REQUEST_MAX_BYTES)
      throw new Error("视频请求超过 64 MB，请缩小区间");
    const input_file = `${requests.size}.request.json`;
    await writeFile(path.join(attempt, input_file), body);
    if (file.startsWith(attempt)) await rm(file);
    requests.set(id, { id, input_file });
  }
  const request_file = path.join(attempt, "requests.json");
  await save(request_file, { format: "responses", requests: [...requests.values()] });
  return { requested: requests.size, request_file };
}

/**
 * 解析批量结果，模型的相对时间加区间起点换算为整片时间。
 * 结果写入独立候选文件，不改动字幕草稿；失败项只列出，不影响已有成果。
 */
export async function read(directory, result_file) {
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
      saved?.status === "succeeded" && saved.response?.format === "responses"
        ? saved.response.raw
        : null;
    if (!response) {
      failed.push({ start, end });
      continue;
    }
    const text = (response.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("\n");
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
      if (
        row !== null &&
        typeof row === "object" &&
        Number.isFinite(row.start) &&
        Number.isFinite(row.end)
      )
        rows.push({ ...row, start: round(row.start + start), end: round(row.end + start) });
      else invalid_lines.push(content);
    }
    ranges.push({
      start,
      end,
      incomplete: response.status !== "completed" || Boolean(response.incomplete_details),
      invalid_lines,
      rows,
    });
  }
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

/** 区间与一组已合并区间的重叠时长。 */
const covered = ([start, end], cover) =>
  cover.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(end, b) - Math.max(start, a)), 0);

/**
 * 字幕草稿与导入证据的对照，只提供线索，不判断字幕对错。
 * 有本地识别时以含文字的识别窗口为证据，否则退回人声区间；无音轨时证据为 null。
 */
export async function check(directory) {
  const root = path.resolve(directory);
  const { speech, asr, segments } = await load(path.join(root, "video.json"));
  const rows = (await exists(path.join(root, "rows.json")))
    ? await load(path.join(root, "rows.json"))
    : [];
  const duration = segments.at(-1).end;
  const dialogue = rows.flatMap((row, index) =>
    valid_row(row, duration) && row.kind === "dialogue"
      ? [{ index, span: [row.start, row.end] }]
      : [],
  );
  const cover = union(dialogue.map(({ span }) => span));
  const evidence = asr ?? speech;
  let uncovered = null;
  if (asr)
    uncovered = asr
      .filter(([start, end]) => covered([start, end], cover) < UNCOVERED_RATIO * (end - start))
      .map(([start, end, text]) => ({ start, end, asr: text }));
  else if (speech) {
    uncovered = [];
    for (let [start, end] of speech) {
      for (const [a, b] of cover) {
        if (b <= start || a >= end) continue;
        if (a - start >= UNCOVERED_SECONDS) uncovered.push({ start, end: a });
        start = Math.max(start, b);
      }
      if (end - start >= UNCOVERED_SECONDS) uncovered.push({ start, end });
    }
  }
  return {
    rows: rows.length,
    invalid_rows: rows.flatMap((row, index) => (valid_row(row, duration) ? [] : [index])),
    evidence: asr ? "asr" : speech ? "speech" : null,
    uncovered,
    unsupported:
      evidence &&
      dialogue.filter(({ span }) => covered(span, evidence) === 0).map(({ index }) => index),
  };
}

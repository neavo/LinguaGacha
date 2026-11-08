import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENCODE, ffmpeg, load, save, valid_row } from "./media.mjs";
import { union } from "./speech.mjs";

const VIDEO_INPUT_MAX_BYTES = 50_000_000; // 单个视频输入的接口上限。
const VIDEO_REQUEST_MAX_BYTES = 64_000_000; // 单个请求体的接口上限。
const UNCOVERED_SECONDS = 0.3; // 只有人声区间时报告的最短未覆盖人声。
const UNCOVERED_RATIO = 0.5; // 本地识别窗口被对白覆盖不足该比例时报告。
const MAX_ATTEMPTS = 2; // 待识别分段的请求上限：首轮一次，原样重试一次。
const REVIEW_RATIO = 0.1; // 已识别分段的补查总时长占整片的上限。
const round = (value) => Number(value.toFixed(3)); // 换算后的时间精度。

/** 请求 ID 即整片时间区间，结果回来时据此换算坐标，不需要另存映射。 */
const range_id = ({ start, end }) => `${start}-${end}`;
const same = (a, b) => a.start === b.start && a.end === b.end; // 区间相同。
const inside = (row, { start, end }) => start <= row.start && row.start < end; // 记录按起点归属区间。
/** 分段状态：已采用视频识别结果、待识别，或请求次数用完而降级为本地 ASR 原文。 */
const status = (segment) =>
  segment.recognized
    ? "recognized"
    : (segment.attempts ?? 0) < MAX_ATTEMPTS
      ? "pending"
      : "degraded";
/** 指定状态的分段区间。 */
const select = (segments, wanted) =>
  segments
    .filter((segment) => status(segment) === wanted)
    .map(({ start, end }) => ({ start, end }));

/**
 * 为整片时间区间准备 `responses` 载荷，不指定 `ranges` 时请求待识别的分段。
 * 区间等于分段时直接使用分段。更小的区间从所在分段裁出，须位于同一分段内。
 * 请求次数与补查时长在准备时计入 `video.json`，停止的批次也计入，超出上限即报错。
 * `user_requested` 表示用户明确要求的请求，越过上限，适用情况由技能规定。
 */
export async function request(directory, { prompt, ranges, user_requested = false }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("必须提供识别提示词");
  const root = path.resolve(directory);
  const manifestFile = path.join(root, "video.json");
  const manifest = await load(manifestFile);
  const { segments } = manifest;
  ranges ??= select(segments, "pending");
  if (!ranges.length) throw new Error("没有待识别的分段");
  const planned = new Map(),
    touched = new Set();
  let review = 0;
  for (const range of ranges) {
    const { start, end } = range;
    const segment = segments.find((item) => item.start <= start && end <= item.end);
    if (!(Number.isFinite(start) && Number.isFinite(end) && start < end) || !segment)
      throw new Error(`区间 ${JSON.stringify(range)} 无效或跨越分段`);
    const id = range_id({ start, end });
    if (planned.has(id)) continue;
    planned.set(id, { id, start, end, segment });
    if (segment.recognized) review += end - start;
    else touched.add(segment); // 同一批次对一个分段只算一次请求。
  }
  if (!user_requested) {
    const degraded = [...touched].filter((segment) => status(segment) === "degraded");
    if (degraded.length)
      throw new Error(
        `分段 ${degraded.map(({ start, end }) => `${start}-${end}`).join("、")} 已请求 ${MAX_ATTEMPTS} 次，已降级为本地 ASR 原文`,
      );
    if ((manifest.review_seconds ?? 0) + review > REVIEW_RATIO * segments.at(-1).end)
      throw new Error("补查预算已用完，剩余疑点记为未决");
  }
  for (const segment of touched) segment.attempts = (segment.attempts ?? 0) + 1;
  manifest.review_seconds = (manifest.review_seconds ?? 0) + review;
  await mkdir(path.join(root, "recognition"), { recursive: true });
  const attempt = await mkdtemp(path.join(root, "recognition", "prepare-"));
  const requests = [];
  for (const { id, start, end, segment } of planned.values()) {
    let file = path.join(root, segment.path);
    if (start !== segment.start || end !== segment.end) {
      file = path.join(attempt, `${requests.length}.mp4`);
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
    const input_file = `${requests.length}.request.json`;
    await writeFile(path.join(attempt, input_file), body);
    if (file.startsWith(attempt)) await rm(file);
    requests.push({ id, input_file });
  }
  const request_file = path.join(attempt, "requests.json");
  await save(request_file, { format: "responses", requests });
  await save(manifestFile, manifest); // 载荷全部写出后才计入，准备失败不消耗次数。
  return { requested: requests.length, request_file };
}

/**
 * 解析批量结果，模型的相对时间加区间起点换算为整片时间。
 * 结果写入独立候选文件，由 `apply` 采用。失败项只列出，已有原文继续保留。
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
      if (valid_row(row, end - start))
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

/**
 * 把采用的候选区间写入 `items.json`：区间内按起点归属的记录整体换成候选行，再按起点稳定排序。
 * 未指定 `ranges` 时只采用正常结束且有内容的区间，以及当前本就没有记录的空区间，
 * 空输出或截断输出不会抹掉已有原文。采用整个分段时标记该分段已识别。
 */
export async function apply(directory, candidate, ranges) {
  const root = path.resolve(directory);
  const manifestFile = path.join(root, "video.json"),
    itemsFile = path.join(root, "items.json");
  const manifest = await load(manifestFile);
  let items = await load(itemsFile);
  const adopted = (await load(candidate)).filter((range) =>
    ranges
      ? ranges.some((wanted) => same(wanted, range))
      : !range.incomplete && (range.rows.length > 0 || !items.some((row) => inside(row, range))),
  );
  if (ranges && adopted.length !== ranges.length)
    throw new Error("ranges 中有候选文件不存在的区间");
  for (const range of adopted) {
    items = [...items.filter((row) => !inside(row, range)), ...range.rows];
    for (const segment of manifest.segments) if (same(segment, range)) segment.recognized = true;
  }
  items.sort((a, b) => a.start - b.start);
  await save(itemsFile, items);
  await save(manifestFile, manifest);
  return {
    adopted: adopted.map(({ start, end }) => ({ start, end })),
    items: items.length,
    pending: select(manifest.segments, "pending"),
    degraded: select(manifest.segments, "degraded"),
  };
}

/** 区间与一组已合并区间的重叠时长。 */
const covered = ([start, end], cover) =>
  cover.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(end, b) - Math.max(start, a)), 0);

/**
 * 字幕原文与导入证据的对照，只提供线索，不判断字幕对错。
 * 有本地识别时以含文字的识别窗口为证据，否则退回人声区间。无音轨时证据为 `null`。
 */
export async function check(directory) {
  const root = path.resolve(directory);
  const { speech, asr, segments } = await load(path.join(root, "video.json"));
  const rows = await load(path.join(root, "items.json"));
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
    pending: select(segments, "pending"),
    degraded: select(segments, "degraded"),
    invalid_rows: rows.flatMap((row, index) => (valid_row(row, duration) ? [] : [index])),
    evidence: asr ? "asr" : speech ? "speech" : null,
    uncovered,
    unsupported:
      evidence &&
      dialogue.filter(({ span }) => covered(span, evidence) === 0).map(({ index }) => index),
  };
}

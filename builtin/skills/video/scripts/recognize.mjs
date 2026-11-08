import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { exists, load, prefix, save, valid_row } from "./media.mjs";

const VIDEO_INPUT_MAX_BYTES = 50_000_000; // 单个视频输入的接口上限。
const VIDEO_REQUEST_MAX_BYTES = 64_000_000; // 单个请求体的接口上限。

/** 逐项准备原生载荷。重识别只建立新材料，已有人工修正仍保留。 */
export async function prepare(directory, { prompt, segments: targets }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("必须提供识别提示词");
  const root = path.resolve(directory);
  const video = await load(path.join(root, "video.json"));
  const queue = [];
  if (targets) {
    for (const index of new Set(targets)) {
      if (!Number.isInteger(index) || !video.segments[index])
        throw new Error(`分段 ${index} 不存在`);
      queue.push(index);
    }
  } else
    for (const index of video.segments.keys()) {
      if (
        !(await exists(path.join(root, `${prefix(index)}.rows.json`))) &&
        !(await exists(path.join(root, `${prefix(index)}.response.json`)))
      )
        queue.push(index);
    }
  if (queue.length === 0) return { requested: 0, request_file: null };
  await mkdir(path.join(root, "recognition"), { recursive: true });
  const attempt = await mkdtemp(path.join(root, "recognition", "prepare-"));
  const requests = [];
  for (const index of queue) {
    const file = path.join(root, video.segments[index].path);
    const bytes = await readFile(file);
    if (bytes.length === 0 || bytes.length >= VIDEO_INPUT_MAX_BYTES)
      throw new Error("视频分段必须非空且小于 50 MB");
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
      throw new Error("视频请求超过 64 MB，请缩小分段");
    const input_file = `${prefix(index)}.request.json`;
    await writeFile(path.join(attempt, input_file), body);
    requests.push({ id: String(index), input_file });
  }
  const request_file = path.join(attempt, "requests.json");
  await save(request_file, { format: "responses", requests });
  return { requested: requests.length, request_file };
}

/** 已发布的结果复制到独立候选目录，失败项不触碰原成果。 */
export async function collect(directory, result_file) {
  const root = path.resolve(directory);
  const result = await load(result_file);
  await mkdir(path.join(root, "recognition"), { recursive: true });
  const candidate = await mkdtemp(path.join(root, "recognition", "candidate-"));
  const video = await load(path.join(root, "video.json"));
  await save(path.join(candidate, "video.json"), {
    ...video,
    segments: video.segments.map((segment) => ({
      ...segment,
      path: path.resolve(root, segment.path),
    })),
  });
  const succeeded = [],
    failed = [];
  for (const entry of result.requests) {
    const index = Number(entry.id);
    if (!Number.isInteger(index) || !video.segments[index])
      throw new Error(`无效的分段 ID：${entry.id}`);
    if (entry.status !== "succeeded" || !entry.result_file) {
      failed.push(index);
      continue;
    }
    const response = await load(path.resolve(path.dirname(result_file), entry.result_file));
    if (
      response.status !== "succeeded" ||
      response.response?.format !== "responses" ||
      response.response.raw?.status !== "completed"
    ) {
      failed.push(index);
      continue;
    }
    await save(path.join(candidate, `${prefix(index)}.response.json`), response);
    succeeded.push(index);
  }
  return { candidate, succeeded, failed };
}

/** 调用方审阅候选行后显式采用。全部候选通过结构校验才写入，失败时保留原成果。 */
export async function accept(directory, candidate, segments) {
  const root = path.resolve(directory);
  const video = await load(path.join(root, "video.json"));
  const duration = video.segments.at(-1).end;
  const prepared = [];
  for (const index of new Set(segments)) {
    if (!Number.isInteger(index) || !video.segments[index]) throw new Error(`分段 ${index} 不存在`);
    const response = await load(path.join(candidate, `${prefix(index)}.response.json`));
    const rows = await load(path.join(candidate, `${prefix(index)}.rows.json`));
    if (!Array.isArray(rows) || response.status !== "succeeded")
      throw new Error(`分段 ${index} 尚未完成质控准备`);
    const invalid = rows.findIndex((row) => !valid_row(row, duration));
    if (invalid !== -1) throw new Error(`分段 ${index} 第 ${invalid} 行不合法`);
    prepared.push({ index, response, rows });
  }
  for (const { index, response, rows } of prepared) {
    await save(path.join(root, `${prefix(index)}.response.json`), response);
    await save(path.join(root, `${prefix(index)}.rows.json`), rows);
  }
  return { accepted: prepared.map(({ index }) => index) };
}

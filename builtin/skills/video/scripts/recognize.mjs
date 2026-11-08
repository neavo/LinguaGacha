import { readFile, writeFile, rename, access, stat, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
const VIDEO_INPUT_MAX_BYTES = 50_000_000;
const VIDEO_REQUEST_MAX_BYTES = 64_000_000;
/** 只用已校验的分段序号生成文件名。 */
const prefix = (index) => String(index).padStart(3, "0");
/** 缺失表示尚无成果，其余读取错误继续上抛。 */
const exists = async (file) =>
  access(file).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
/** 读取本次工作目录中的 JSON 材料。 */
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
/** 完整写入后再替换目标，失败保留旧成果。 */
async function save(file, value) {
  await writeFile(file + ".tmp", JSON.stringify(value, null, 2));
  await rename(file + ".tmp", file);
}

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
    const info = await stat(file);
    if (!info.isFile() || info.size === 0 || info.size >= VIDEO_INPUT_MAX_BYTES)
      throw new Error("视频分段必须为非空且小于 50 MB 的文件");
    const bytes = await readFile(file);
    if (bytes.length >= VIDEO_INPUT_MAX_BYTES) throw new Error("视频分段超过 50 MB");
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

/** 调用方审阅候选行后显式采用，缺少候选行时保留原成果。 */
export async function accept(directory, candidate, segments) {
  const root = path.resolve(directory);
  const video = await load(path.join(root, "video.json"));
  const prepared = [];
  for (const index of new Set(segments)) {
    if (!Number.isInteger(index) || !video.segments[index]) throw new Error(`分段 ${index} 不存在`);
    const response = await load(path.join(candidate, `${prefix(index)}.response.json`));
    const rows = await load(path.join(candidate, `${prefix(index)}.rows.json`));
    if (!Array.isArray(rows) || response.status !== "succeeded")
      throw new Error(`分段 ${index} 尚未完成质控准备`);
    prepared.push({ index, response, rows });
  }
  for (const { index, response, rows } of prepared) {
    await save(path.join(root, `${prefix(index)}.response.json`), response);
    await save(path.join(root, `${prefix(index)}.rows.json`), rows);
  }
  return { accepted: prepared.map(({ index }) => index) };
}

import { readFile, writeFile, rename, access, rm, stat } from "node:fs/promises";
import path from "node:path";

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 2; // 单次调用内每段的请求上限，只对请求失败重试。
const VIDEO_INPUT_MAX_BYTES = 50_000_000;
const VIDEO_REQUEST_MAX_BYTES = 64_000_000;
const REQUEST = {
  config_id: "preset-volcengine",
  api: "responses",
  model: "doubao-seed-2-1-lite-260915",
  fps: 1,
  reasoning: { effort: "low" },
  max_output_tokens: 32768,
};

/** 仅文件缺失表示尚未请求，其他 IO 错误继续上抛。 */
const exists = async (file) =>
  access(file).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

/** 原子发布响应，避免中断留下半份 JSON。 */
async function save(file, value) {
  await writeFile(file + ".tmp", JSON.stringify(value, null, 2));
  await rename(file + ".tmp", file);
}

/**
 * 逐段请求识别，原始响应保存为 `NNN.response.json`，解析与质控由 Agent 完成。
 * 未指定 `segments` 时续跑缺失分段。指定时作废目标分段的旧响应与行。
 */
export async function recognize(directory, { prompt, segments: targets }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("必须提供识别提示词");
  const root = path.resolve(directory);
  const { segments } = JSON.parse(await readFile(path.join(root, "video.json"), "utf8"));
  const prefix = (index) => path.join(root, String(index).padStart(3, "0"));
  let queue = [];
  if (targets) {
    queue = [...new Set(targets)];
    // 先校验全部目标，输入错误不能撤掉已有成果。
    for (const index of queue)
      if (!Number.isInteger(index) || !segments[index]) throw new Error(`分段 ${index} 不存在`);
    for (const index of queue) {
      await rm(prefix(index) + ".response.json", { force: true });
      await rm(prefix(index) + ".rows.json", { force: true });
    }
  } else
    for (const index of segments.keys())
      // 保留段可以只有从工程恢复的行，无需重新付费识别。
      if (
        !(await exists(prefix(index) + ".rows.json")) &&
        !(await exists(prefix(index) + ".response.json"))
      )
        queue.push(index);
  const failed = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < queue.length) {
        const index = queue[cursor++];
        const bodyFile = prefix(index) + ".request.json"; // 大请求体通过文件交给宿主。
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const file = path.join(root, segments[index].path);
            const info = await stat(file);
            if (!info.isFile() || info.size === 0 || info.size >= VIDEO_INPUT_MAX_BYTES)
              throw new Error("视频分段必须为非空且小于 50 MB 的文件");
            const body = JSON.stringify({
              model: REQUEST.model,
              stream: false,
              reasoning: REQUEST.reasoning,
              max_output_tokens: REQUEST.max_output_tokens,
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_video",
                      video_url: `data:video/mp4;base64,${(await readFile(file)).toString("base64")}`,
                      fps: REQUEST.fps,
                    },
                    { type: "input_text", text: prompt },
                  ],
                },
              ],
            });
            if (Buffer.byteLength(body) > VIDEO_REQUEST_MAX_BYTES)
              throw new Error("视频请求超过 64 MB，请缩小分段");
            await writeFile(bodyFile, body);
            const response = await ws.requestLLM({
              config_id: REQUEST.config_id,
              api: REQUEST.api,
              body_file: bodyFile,
            });
            await save(prefix(index) + ".response.json", JSON.parse(response));
            console.log(`识别 ${index + 1}/${segments.length}`);
            break;
          } catch (error) {
            console.log(`分段 ${index} 第 ${attempt} 次请求失败：${error.message}`);
            if (attempt === MAX_ATTEMPTS) failed.push({ index, error: error.message });
          } finally {
            await rm(bodyFile, { force: true }); // 请求结算后释放 base64 副本。
          }
        }
      }
    }),
  );
  console.log(JSON.stringify({ requested: queue.length, failed }));
}

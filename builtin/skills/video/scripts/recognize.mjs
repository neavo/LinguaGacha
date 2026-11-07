import { readFile, writeFile, rename, access, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { uv } from "@lg/uv";

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 2;
const media = fileURLToPath(new URL("./media.py", import.meta.url));
/** 读取已原子发布的工作材料。 */
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
/** 仅文件缺失表示尚未完成，其他 IO 错误继续上抛。 */
const exists = async (file) =>
  access(file).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
/** 原子发布响应和尝试次数，避免中断留下半份 JSON。 */
async function save(file, value) {
  await writeFile(file + ".tmp", JSON.stringify(value, null, 2));
  await rename(file + ".tmp", file);
}

/** 主脚本持有宿主通道，Python 只消费已落盘的响应。续跑不隐式增加重试预算。 */
export async function recognize(directory, { prompt }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("必须提供识别提示词");
  const root = path.resolve(directory);
  const state = await read(path.join(root, "state.json"));
  // 续跑绑定完整提示词和来源，防止把旧结果用于新的识别任务。
  const signature = createHash("sha256")
    .update(JSON.stringify({ prompt, segments: state.segments, source: state.source ?? null }))
    .digest("hex");
  const runFile = path.join(root, "recognition.json");
  if (await exists(runFile)) {
    if ((await read(runFile)).signature !== signature)
      throw new Error("提示词或来源已变化，请使用新的识别目录");
  } else await save(runFile, { signature });
  for (let round = 0; round < MAX_ATTEMPTS; round++) {
    await uv.run(["run", "python", media, "analyze", root]);
    const review = await read(path.join(root, "review.json"));
    const queue = review.filter((entry) => entry.missing || entry.retry);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < queue.length) {
          const { index } = queue[cursor++];
          const prefix = path.join(root, String(index).padStart(3, "0"));
          const attemptFile = prefix + ".attempts.json";
          const attempts = (await exists(attemptFile)) ? (await read(attemptFile)).count : 0;
          if (attempts >= MAX_ATTEMPTS) continue;
          // 请求前占用尝试次数，进程中止也不会在续跑时造成无界付费重试。
          await save(attemptFile, { count: attempts + 1 });
          await rm(prefix + ".parsed.json", { force: true }); // 仅重试段撤销旧解析结果。
          try {
            const response = JSON.parse(
              await ws.requestVideo(path.join(root, state.segments[index].path), prompt),
            );
            await save(prefix + ".response.json", response);
            console.log(`识别 ${index + 1}/${state.segments.length}，尝试 ${attempts + 1}`);
          } catch (error) {
            await save(attemptFile, { count: attempts + 1, error: error.message });
            console.log(`分段 ${index} 请求失败：${error.message}`);
          }
        }
      }),
    );
  }
  await uv.run(["run", "python", media, "analyze", root]);
  console.log(JSON.stringify(await read(path.join(root, "review.json")), null, 2));
}

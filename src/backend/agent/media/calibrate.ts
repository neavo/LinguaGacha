/** CPU/GPU 各一次的语音测量子进程；不预热，不重复执行。 */
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Engine } from "./inference-engine";
import type { MediaCalibrationJob } from "./worker-protocol";

// 与语音前端约 20 秒窗口对应，只测推理负载，不用于质量验收。
const SHAPE = [1, 333, 560];

/** IPC 启动参数只接受项目定义的设备配置，路径必须是父进程解析好的绝对路径。 */
function read_job(value: unknown): MediaCalibrationJob {
  if (!value || typeof value !== "object") throw new Error("Invalid calibration job.");
  const job = value as MediaCalibrationJob;
  if (
    !path.isAbsolute(job.worker ?? "") ||
    typeof job.config?.ort !== "string" ||
    !job.config.ort.startsWith("file:") ||
    !path.isAbsolute(job.config.tokens ?? "")
  )
    throw new Error("Invalid calibration configuration.");
  for (const task of ["vad", "asr", "det"] as const) {
    const model = job.config.models?.[task];
    if (!model || !path.isAbsolute(model.file) || !["cpu", "webgpu"].includes(model.device))
      throw new Error("Invalid calibration model.");
  }
  return job;
}

process.once("message", async (value: unknown) => {
  try {
    const job = read_job(value);
    const began = performance.now();
    const engine = new Engine(job.config, job.worker);
    const input = new Float32Array(SHAPE.reduce((size, n) => size * n, 1));
    for (let i = 0; i < input.length; i++) input[i] = Math.sin(i * 0.37);
    let inference = 0,
      prepare = 0;
    try {
      const reply = await engine.request(
        0,
        "asr",
        {
          dtype: "float32",
          shape: SHAPE,
          language: "auto",
          measure: true,
        },
        new Uint8Array(input.buffer),
      );
      inference = Number(reply.header.inference_ms);
      prepare = performance.now() - began - inference;
    } finally {
      const start = performance.now();
      await engine.close();
      if (inference > 0)
        await new Promise<void>((resolve, reject) =>
          process.send!({ inference, prepare, close: performance.now() - start }, (error) =>
            error ? reject(error) : resolve(),
          ),
        );
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
});

/**
 * 校准子进程入口：用正式执行核心测量一个候选配置，发送结果后自然退出。
 * 父进程只在收到有效结果且本进程正常关闭后才接受候选。
 */
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Engine } from "./inference-engine";
import type { MediaCalibrationJob, MediaTask } from "./worker-protocol";

const ROUNDS = 3; // 每个输入档的有效批次数。
// 每批每档四个请求，两路各消费两次。确定性输入只近似本机吞吐，质量另用真实素材验收。
const BATCH = 4;
const IN_FLIGHT = 2; // 与 `media.py` 的在途上限一致。
/** 短、长两个输入档：ASR 约 5 秒与 20 秒窗口，检测为横屏与竖屏。 */
const SHAPES = {
  asr: [
    [1, 83, 560],
    [1, 333, 560],
  ],
  det: [
    [1, 3, 352, 640],
    [1, 3, 640, 352],
  ],
} as const;

type Input = Readonly<{ task: Exclude<MediaTask, "vad">; shape: number[]; input: Float32Array }>;

/** IPC 启动参数只接受项目定义的任务与配置，路径必须是父进程解析好的绝对路径。 */
function read_job(value: unknown): MediaCalibrationJob {
  if (!value || typeof value !== "object") throw new Error("Invalid calibration job.");
  const job = value as MediaCalibrationJob;
  if (
    !["asr", "det", "mixed"].includes(job.task) ||
    !["cpu", "webgpu"].includes(job.profile?.asr) ||
    !["cpu", "webgpu_single", "webgpu_dual"].includes(job.profile?.det) ||
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

/** 每次请求复制输入，因为载荷缓冲区会转移给 Worker。 */
const infer = (engine: Engine, { task, shape, input }: Input) =>
  engine.request(
    0,
    task,
    { dtype: "float32", shape, language: "auto" },
    new Uint8Array(input.slice().buffer),
  );

process.once("message", async (value: unknown) => {
  try {
    const job = read_job(value);
    const tasks: Input["task"][] = job.task === "mixed" ? ["asr", "det"] : [job.task];
    const began = performance.now();
    const engine = new Engine(job.profile, job.config, job.worker);
    const inputs = tasks.map((task) =>
      SHAPES[task].map((shape): Input => {
        const input = new Float32Array(shape.reduce((total: number, n) => total * n, 1));
        for (let i = 0; i < input.length; i++) input[i] = Math.sin(i * 0.37);
        return { task, shape: [...shape], input };
      }),
    );
    /** 一批：每个任务按在途上限派发同一档输入。 */
    const batch = async (slot: number): Promise<void> => {
      await Promise.all(
        inputs.map(async (shapes) => {
          for (let i = 0; i < BATCH; i += IN_FLIGHT)
            await Promise.all(
              Array.from({ length: IN_FLIGHT }, () => infer(engine, shapes[slot]!)),
            );
        }),
      );
    };
    const timings: number[][] = [[], []];
    let prepare = 0;
    try {
      // 首轮两档用作预热，计入准备耗时。
      await batch(0);
      await batch(1);
      prepare = performance.now() - began;
      for (let round = 0; round < ROUNDS; round++)
        for (let slot = 0; slot < 2; slot++) {
          const start = performance.now();
          await batch(slot);
          timings[slot]!.push(performance.now() - start);
        }
    } finally {
      const start = performance.now();
      await engine.close();
      const complete = timings.every((row) => row.length === ROUNDS);
      // 同一根进程先后创建和释放两类会话也曾触发原生收尾问题。
      if (job.task === "mixed" && complete)
        for (const shapes of inputs) {
          const sequential = new Engine(job.profile, job.config, job.worker);
          try {
            await infer(sequential, shapes[0]!);
          } finally {
            await sequential.close();
          }
        }
      if (complete)
        await new Promise<void>((resolve, reject) =>
          process.send!({ timings, prepare, close: performance.now() - start }, (error) =>
            error ? reject(error) : resolve(),
          ),
        );
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect(); // IPC 不能阻止进程自然退出。
  }
});

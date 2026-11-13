/**
 * 一次计算操作的资源所有权：根线程持有 Python helper 与推理 Worker，桥接两者的请求，
 * 等全部资源退出后才返回结果。设备由调用者指定，失败完成清理后交回调用者。
 */
import { ort_entry, python } from "../inference/environment";
import path from "node:path";
import { Engine } from "./inference-engine";
import {
  inference_configuration,
  run_inference_operation,
  close_inference,
} from "../inference/runtime";
import { run_helper } from "../inference/helper";
import { MEDIA_MODELS } from "./models";
import type { DeviceOptions, MediaDevice, MediaWorkerConfig } from "./worker-protocol";

/** 设备来自 AGENT 脚本，未知值必须在资源准备前拒绝。 */
export function validate_device(device: unknown): void {
  if (device !== "cpu" && device !== "gpu") throw new Error("Media device must be cpu or gpu.");
}

/** 模型路径只取宿主绑定的共享目录。 */
const model_file = (model: { file: string }): string =>
  path.join(inference_configuration().modelsDirectory, model.file);
/** 私有运行资源随应用部署。 */
export const runtime_file = (name: string): string =>
  path.join(inference_configuration().runtimeDirectory, "runtime", name);

/** 每次调用独占引擎。调用者在安全收尾后决定是否重跑。 */
export async function operate<T>(
  action: (engine: Engine) => Promise<T>,
  { device }: DeviceOptions,
): Promise<T> {
  validate_device(device);
  // 在真正执行时检查关闭失败，覆盖排队期间发生的故障。
  return run_inference_operation(device, async () => {
    const engine = new Engine(
      worker_config(device === "gpu" ? "webgpu" : "cpu"),
      runtime_file("media-worker.mjs"),
    );
    try {
      return await action(engine);
    } finally {
      await close_inference(engine);
    }
  });
}

/**
 * 运行 `media.py` 的一个命令。helper 的推理请求转发给 Worker，应答按编号写回。
 * 正常返回要求收到结果帧、helper 正常退出。任一请求失败时结束 helper 并抛出该失败。
 */
export async function helper(
  command: string,
  job: Readonly<Record<string, unknown>>,
  engine?: Engine,
): Promise<unknown> {
  const stream = engine?.open();
  try {
    return await run_helper(
      python(),
      runtime_file("media.py"),
      command,
      job,
      engine
        ? (header, payload) => {
            const kind = header.kind;
            if (kind !== "vad" && kind !== "asr" && kind !== "det" && kind !== "rec")
              throw new Error("Unexpected media task");
            return engine.request(stream!, kind, header, payload);
          }
        : undefined,
    );
  } finally {
    if (stream !== undefined) engine!.release(stream);
  }
}

/** 配置与路径在父进程解析，执行核心不访问共享环境绑定。 */
function worker_config(device: MediaDevice): MediaWorkerConfig {
  const model = (key: keyof typeof MEDIA_MODELS, device: "cpu" | "webgpu", threads = 4) => ({
    file: model_file(MEDIA_MODELS[key]),
    device,
    threads,
  });
  return {
    ort: ort_entry(),
    tokens: model_file(MEDIA_MODELS.tokens),
    models: {
      vad: model("vad", "cpu", 1),
      asr: model(device === "cpu" ? "asr_cpu" : "asr_gpu", device),
      det: model(device === "cpu" ? "det_cpu" : "det_gpu", device),
      rec: model(device === "cpu" ? "rec_cpu" : "rec_gpu", device),
    },
  };
}

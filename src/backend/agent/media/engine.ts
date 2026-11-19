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
import {
  check_media_helper_request,
  read_media_helper_response,
  type MediaHelperOperation,
  type MediaHelperRequest,
  type MediaHelperResponse,
} from "../../../shared/media";

/** 模型路径只取宿主绑定的共享目录。 */
const model_file = (model: { file: string }): string =>
  path.join(inference_configuration().modelsDirectory, model.file);
/** 每次调用独占引擎。调用者在安全收尾后决定是否重跑。 */
export async function operate<T>(
  action: (engine: Engine) => Promise<T>,
  { device }: DeviceOptions,
): Promise<T> {
  return run_inference_operation(device, async () => {
    const engine = new Engine(
      worker_config(device === "gpu" ? "webgpu" : "cpu"),
      path.join(inference_configuration().runtimeDirectory, "runtime", "media-worker.mjs"),
    );
    try {
      return await action(engine);
    } finally {
      await close_inference(engine);
    }
  });
}

/**
 * 一次推理作业的 helper 独占引擎。联系表只使用 Python 通道。
 */
export async function helper<K extends MediaHelperOperation>(
  script: URL,
  command: K,
  job: MediaHelperRequest<K>,
  engine?: Engine,
): Promise<MediaHelperResponse<K>> {
  if (!check_media_helper_request(command, job))
    throw new Error(`Invalid media helper request: ${command}`);
  const response = await run_helper(
    python(),
    script,
    command,
    job,
    engine &&
      ((header, payload) => {
        const kind = header.kind;
        if (kind !== "vad" && kind !== "asr" && kind !== "detection" && kind !== "recognition")
          throw new Error("Unexpected media task");
        return engine.request(kind, header, payload);
      }),
  );
  return read_media_helper_response(command, response);
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
      detection: model("detection", device),
      recognition: model("recognition", device),
    },
  };
}

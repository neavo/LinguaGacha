import path from "node:path";
import { InferenceClient } from "../inference/client";
import { ort_entry, python } from "../inference/environment";
import { run_helper } from "../inference/helper";
import {
  inference_configuration,
  run_inference_operation,
  close_inference,
} from "../inference/runtime";
import { IMAGE_MODELS } from "./models";
import { model_ready } from "../inference/models";

export type ImageDevice = "cpu" | "gpu"; // 调用方可选的推理设备。
export type ImageWorkerConfig = {
  ort: string;
  file: string;
  kind: "shadow" | "inpaint";
  device: "cpu" | "webgpu";
}; // 传给推理 Worker 线程的启动配置。
let tail: Promise<unknown> = Promise.resolve(); // 串行化所有像素作业的队列尾节点。

/** 页操作串行，单次像素作业内复用模型 Worker；实际退出后才接纳下一作业。 */
export function pixels(
  command: string,
  args: Readonly<Record<string, unknown>>,
  device: ImageDevice = "cpu",
): Promise<unknown> {
  if (device !== "cpu" && device !== "gpu") throw new Error("Invalid image device");
  const result = tail.then(() =>
    run_inference_operation(device, async () => {
      const config = inference_configuration();
      const runtime = path.join(config.runtimeDirectory, "runtime");
      const workers = new Map<string, InferenceClient>();
      try {
        return await run_helper(
          python(),
          path.join(runtime, "image.py"),
          command,
          args,
          async (header, payload) => {
            const kind = header.kind;
            if (kind !== "shadow" && kind !== "inpaint")
              throw new Error("Unknown image inference request");
            let worker = workers.get(kind);
            if (!worker) {
              const model = IMAGE_MODELS[kind];
              if (!model_ready(config.modelsDirectory, model))
                throw new Error("Image model missing; call prepare_models first");
              worker = new InferenceClient(
                {
                  ort: ort_entry(),
                  file: path.join(config.modelsDirectory, model.file),
                  kind,
                  device: device === "gpu" ? "webgpu" : "cpu",
                } satisfies ImageWorkerConfig,
                path.join(runtime, "image-worker.mjs"),
              );
              workers.set(kind, worker);
            }
            return await worker.request(
              device === "gpu" ? "gpu" : "image",
              { kind },
              header,
              payload,
            );
          },
        );
      } finally {
        await Promise.all([...workers.values()].map(close_inference));
      }
    }),
  );
  tail = result.catch(() => undefined); // 调用者接收错误，队列仅负责顺序。
  return result;
}

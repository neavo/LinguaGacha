import path from "node:path";
import { InferenceClient } from "../inference/client";
import { ort_entry, python } from "../inference/environment";
import { run_helper } from "../inference/helper";
import { model_ready } from "../inference/models";
import {
  close_inference,
  inference_configuration,
  run_inference_operation,
} from "../inference/runtime";
import { IMAGE_MODELS, type ImageModelKind } from "./models";

export type ImageDevice = "cpu" | "gpu"; // 调用方可选的推理设备。
export type ImageWorkerConfig = {
  ort: string;
  device: "cpu" | "webgpu";
  models: Record<ImageModelKind, string>;
}; // 传给图片单推理 Worker 线程的启动配置。

let tail: Promise<unknown> = Promise.resolve(); // 串行化所有像素作业的队列尾节点。

/** 页操作串行，单次像素作业内按需创建并复用单个图片 Worker。纯像素命令不创建 Worker。 */
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
      const lane = device === "gpu" ? "gpu" : "image";
      let client: InferenceClient | undefined;
      try {
        return await run_helper(
          python(),
          path.join(runtime, "image.py"),
          command,
          args,
          async (header, payload) => {
            const kind = header.kind;
            if (kind !== "bubble" && kind !== "text")
              throw new Error("Unknown image inference request");
            if (!model_ready(config.modelsDirectory, IMAGE_MODELS[kind]))
              throw new Error(`Image model missing (${kind}); call prepare_models first`);
            client ??= new InferenceClient(
              {
                ort: ort_entry(),
                device: device === "gpu" ? "webgpu" : "cpu",
                models: {
                  bubble: path.join(config.modelsDirectory, IMAGE_MODELS.bubble.file),
                  text: path.join(config.modelsDirectory, IMAGE_MODELS.text.file),
                },
              } satisfies ImageWorkerConfig,
              path.join(runtime, "image-worker.mjs"),
            );
            return await client.request(lane, { kind }, header, payload);
          },
        );
      } finally {
        if (client) await close_inference(client);
      }
    }),
  );
  tail = result.catch(() => undefined); // 调用者接收错误，队列仅负责顺序。
  return result;
}

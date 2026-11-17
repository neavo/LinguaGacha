import path from "node:path";
import { InferenceClient } from "../inference/client";
import { ort_entry, python } from "../inference/environment";
import { run_helper } from "../inference/helper";
import { model_exists } from "../inference/models";
import {
  close_inference,
  inference_configuration,
  run_inference_operation,
} from "../inference/runtime";
import { IMAGE_MODELS, IMAGE_RESOURCES, type ImageModelKind } from "./models";
import {
  check_image_helper_request,
  read_image_helper_response,
  type ImageHelperOperation,
  type ImageHelperRequest,
  type ImageHelperResponse,
} from "../../../shared/image-helper";

export type ImageDevice = "cpu" | "gpu"; // 调用方可选的推理设备。
export type ImageWorkerConfig = {
  ort: string;
  device: "cpu" | "webgpu";
  models: Record<ImageModelKind, string>;
  dictionary: string;
}; // 传给图片单推理 Worker 线程的启动配置。

let tail: Promise<unknown> = Promise.resolve(); // 串行化所有像素作业的队列尾节点。

/** 页操作串行，单次像素作业内按需创建并复用单个图片 Worker。纯像素命令不创建 Worker。 */
export function pixels<K extends ImageHelperOperation>(
  command: K,
  args: ImageHelperRequest<K>,
  device: ImageDevice = "cpu",
): Promise<ImageHelperResponse<K>> {
  const result = tail.then(() =>
    run_inference_operation(device, async () => {
      if (!check_image_helper_request(command, args))
        throw new Error(`Invalid image helper request: ${command}`);
      const config = inference_configuration();
      const runtime = path.join(config.runtimeDirectory, "runtime");
      const lane = device === "gpu" ? "gpu" : "image";
      let client: InferenceClient | undefined;
      try {
        const response = await run_helper(
          python(),
          "lg.image.helper",
          command,
          args,
          async (header, payload) => {
            const kind = header.kind;
            if (
              kind !== "bubble" &&
              kind !== "detection" &&
              kind !== "recognition" &&
              kind !== "inpaint"
            )
              throw new Error("Unknown image inference request");
            if (!model_exists(config.modelsDirectory, IMAGE_MODELS[kind]))
              throw new Error(`Image model missing (${kind}); call prepare_models first`);
            client ??= new InferenceClient(
              {
                ort: ort_entry(),
                device: device === "gpu" ? "webgpu" : "cpu",
                models: {
                  bubble: path.join(config.modelsDirectory, IMAGE_MODELS.bubble.file),
                  detection: path.join(config.modelsDirectory, IMAGE_MODELS.detection.file),
                  recognition: path.join(config.modelsDirectory, IMAGE_MODELS.recognition.file),
                  inpaint: path.join(config.modelsDirectory, IMAGE_MODELS.inpaint.file),
                },
                dictionary: path.join(config.modelsDirectory, IMAGE_RESOURCES.dictionary.file),
              } satisfies ImageWorkerConfig,
              path.join(runtime, "image-worker.mjs"),
            );
            return await client.request(lane, { kind }, header, payload);
          },
        );
        return read_image_helper_response(command, response);
      } finally {
        if (client) await close_inference(client);
      }
    }),
  );
  tail = result.catch(() => undefined); // 调用者接收错误，队列仅负责顺序。
  return result;
}

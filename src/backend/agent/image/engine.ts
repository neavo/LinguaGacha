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

let tail: Promise<unknown> = Promise.resolve();

/** 图片作业按调用顺序串行。扫描与准备在单次作业中按需创建并复用图片 Worker。 */
export function pixels<K extends ImageHelperOperation>(
  script: URL,
  command: K,
  args: ImageHelperRequest<K>,
  device: ImageDevice = "cpu",
): Promise<ImageHelperResponse<K>> {
  if (device !== "cpu" && device !== "gpu") throw new Error("Invalid image device");
  const result = tail.then(() =>
    run_inference_operation(device, async () => {
      if (!check_image_helper_request(command, args))
        throw new Error(`Invalid image helper request: ${command}`);
      const config =
        command === "scan" || command === "prepare" ? inference_configuration() : undefined;
      const lane = device === "gpu" ? "gpu" : "image";
      let client: InferenceClient | undefined;
      try {
        const response = await run_helper(
          python(),
          script,
          command,
          args,
          config &&
            (async (header, payload) => {
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
                path.join(config.runtimeDirectory, "runtime", "image-worker.mjs"),
              );
              return await client.request(lane, { kind }, header, payload);
            }),
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

import { createHash } from "node:crypto";
import { default_native_fs as fs } from "../../../native/native-fs";
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

export type ImageDevice = "cpu" | "gpu";
export type ImageWorkerConfig = {
  ort: string;
  file: string;
  kind: "shadow" | "inpaint";
  device: "cpu" | "webgpu";
};
let tail: Promise<unknown> = Promise.resolve();

/** 页操作串行，每个模型请求独占 Worker；实际退出后才接纳下一作业。 */
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
      return run_helper(
        python(),
        path.join(runtime, "image.py"),
        command,
        args,
        async (header, payload) => {
          const kind = header.kind;
          if (kind !== "shadow" && kind !== "inpaint")
            throw new Error("Unknown image inference request");
          const model = IMAGE_MODELS[kind];
          if (!model_ready(config.modelsDirectory, model))
            throw new Error("Image model missing; call prepare_models first");
          const hash = createHash("sha256");
          for await (const bytes of fs.create_read_stream(
            path.join(config.modelsDirectory, model.file),
          ))
            hash.update(bytes as Buffer);
          if (hash.digest("hex") !== model.sha256)
            throw new Error("Image model checksum mismatch; prepare models again");
          const worker = new InferenceClient(
            {
              ort: ort_entry(),
              file: path.join(config.modelsDirectory, model.file),
              kind,
              device: device === "gpu" ? "webgpu" : "cpu",
            } satisfies ImageWorkerConfig,
            path.join(runtime, "image-worker.mjs"),
          );
          try {
            return await worker.request(
              device === "gpu" ? "gpu" : "image",
              { kind },
              header,
              payload,
            );
          } finally {
            await close_inference(worker);
          }
        },
      );
    }),
  );
  tail = result.catch(() => undefined); // 调用者接收错误，队列仅负责顺序。
  return result;
}

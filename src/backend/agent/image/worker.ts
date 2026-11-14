import { parentPort, workerData } from "node:worker_threads";
import { tensor_shape, type ChannelHeader } from "../inference/channel";
import { check_finite, float, infer, type Ort, type OrtSession } from "../inference/ort";
import { detect_text } from "../inference/text-detection";
import type { ImageWorkerConfig } from "./engine";
import type { ImageModelKind } from "./models";

// 单一图片 Worker 懒加载最多三个模型会话，避免 WebGPU 多 Worker 并发冲突。
const config = workerData as ImageWorkerConfig;
const port = parentPort!;
const loaded = (await import(config.ort)) as Ort & { default?: Ort };
const ort = loaded.default ?? loaded;
const sessions = new Map<ImageModelKind, Promise<OrtSession>>();

function session(kind: ImageModelKind): Promise<OrtSession> {
  let pending = sessions.get(kind);
  if (!pending) {
    pending = ort.InferenceSession.create(config.models[kind], {
      executionProviders: [config.device],
      intraOpNumThreads: 4,
      interOpNumThreads: 1,
      logSeverityLevel: 3,
    });
    sessions.set(kind, pending);
  }
  return pending;
}

async function run_manga_or_inpaint(
  kind: "manga" | "inpaint",
  input: Float32Array,
  shape: number[],
): Promise<{ header: Record<string, unknown>; payload: ArrayBuffer }> {
  const expectedChannels = kind === "manga" ? 3 : 4;
  if (shape.length !== 4 || shape[0] !== 1 || shape[1] !== expectedChannels)
    throw new Error("Invalid image tensor");
  const model = await session(kind);
  const plane = shape[2]! * shape[3]!;
  const feeds =
    kind === "manga"
      ? { [model.inputNames[0]!]: new ort.Tensor("float32", input, shape) }
      : {
          image: new ort.Tensor("float32", input.subarray(0, 3 * plane), [
            1,
            3,
            shape[2]!,
            shape[3]!,
          ]),
          mask: new ort.Tensor("float32", input.subarray(3 * plane), [1, 1, shape[2]!, shape[3]!]),
        };
  const outputs = await infer(model, feeds);
  try {
    const names = kind === "manga" ? ["output0", "output1"] : [model.outputNames[0]!];
    const tensors = names.map((name) => {
      const value = outputs[name];
      if (!value) throw new Error("Missing model output");
      check_finite(float(value.data));
      return value;
    });
    const data = new Float32Array(
      tensors.reduce((sum, tensor) => sum + float(tensor.data).length, 0),
    );
    let offset = 0;
    for (const tensor of tensors) {
      data.set(float(tensor.data), offset);
      offset += float(tensor.data).length;
    }
    return {
      header: { shapes: tensors.map((tensor) => tensor.dims) },
      payload: data.buffer,
    };
  } finally {
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
}

async function shutdown(): Promise<void> {
  const created = await Promise.allSettled(sessions.values());
  sessions.clear();
  for (const result of created) if (result.status === "fulfilled") await result.value.release();
  port.close();
}

let queue = Promise.resolve(); // close 在当前推理与张量释放之后执行。
type Request =
  | { type: "close" }
  | { type: "infer"; id: number; kind: string; header: ChannelHeader; payload: ArrayBuffer };

port.on("message", (message: Request) => {
  queue = queue.then(async () => {
    if (message.type === "close") {
      await shutdown();
      return;
    }
    try {
      const shape = tensor_shape(message.header, message.payload.byteLength);
      const input = new Float32Array(message.payload);
      check_finite(input);
      if (message.kind === "det") {
        const result = await detect_text(ort, await session("det"), input, shape);
        port.postMessage(
          {
            id: message.id,
            header: { dtype: "float32", shape: result.shape },
            payload: result.data.buffer,
          },
          [result.data.buffer],
        );
        return;
      }
      if (message.kind === "manga" || message.kind === "inpaint") {
        const result = await run_manga_or_inpaint(message.kind, input, shape);
        port.postMessage({ id: message.id, ...result }, [result.payload]);
        return;
      }
      throw new Error(`Unknown image task: ${message.kind}`);
    } catch (error) {
      port.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

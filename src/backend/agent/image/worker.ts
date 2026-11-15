import { parentPort, workerData } from "node:worker_threads";
import { tensor_shape, type ChannelHeader } from "../inference/channel";
import { check_finite, float, infer, type Ort, type OrtSession } from "../inference/ort";
import { detect_text } from "../inference/text-detection";
import type { ImageModelKind } from "./models";
import type { ImageWorkerConfig } from "./engine";

// 单一图片 Worker 按任务懒加载模型会话，避免 WebGPU 多 Worker 并发冲突。
const config = workerData as ImageWorkerConfig;
const port = parentPort!;
const loaded = (await import(config.ort)) as Ort & { default?: Ort };
const ort = loaded.default ?? loaded;
const pending: Partial<Record<ImageModelKind, Promise<OrtSession>>> = {}; // 创建中的会话也共享，失败后交给宿主结束本次作业。

/** 固定显式后端，初始化失败不切换设备重试。 */
function session(kind: ImageModelKind): Promise<OrtSession> {
  return (pending[kind] ??= ort.InferenceSession.create(config.models[kind], {
    executionProviders: [config.device],
    intraOpNumThreads: 4,
    interOpNumThreads: 1,
    logSeverityLevel: 3,
  }));
}

/** 只把已核对布局与有限值的张量传给 Python，成功或失败都释放原生输出。 */
async function run_bubble(
  input: Float32Array,
  shape: number[],
): Promise<{ header: Record<string, unknown>; payload: ArrayBuffer }> {
  if (
    shape.length !== 4 ||
    shape[0] !== 1 ||
    shape[1] !== 3 ||
    shape[2]! % 32 !== 0 ||
    shape[3]! % 32 !== 0
  )
    throw new Error("Invalid image tensor");
  const model = await session("bubble");
  const outputs = await infer(model, {
    [model.inputNames[0]!]: new ort.Tensor("float32", input, shape),
  });
  try {
    const names = ["output0", "output1"];
    const tensors = names.map((name) => {
      const value = outputs[name];
      if (!value) throw new Error("Missing model output");
      check_finite(float(value.data));
      return value;
    });
    const [boxes, proto] = tensors;
    const expectedBoxes = [1, 37, 21 * (shape[2]! / 32) * (shape[3]! / 32)];
    const expectedProto = [1, 32, shape[2]! / 4, shape[3]! / 4];
    for (const [tensor, expected] of [
      [boxes!, expectedBoxes],
      [proto!, expectedProto],
    ] as const) {
      if (
        tensor.dims.length !== expected.length ||
        tensor.dims.some((n, i) => n !== expected[i]) ||
        float(tensor.data).length !== expected.reduce((a, b) => a * b, 1)
      )
        throw new Error("Invalid bubble model output shape");
    }
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

/** 将共享文字检测结果装入图片通道的张量列表。 */
async function run_text(input: Float32Array, shape: number[]) {
  const result = await detect_text(ort, await session("text"), input, shape);
  return { header: { shapes: [result.shape] }, payload: result.data.buffer };
}

/** 创建失败时没有会话可释放，成功创建的会话必须释放后才能关闭通道。 */
async function shutdown(): Promise<void> {
  const sessions = await Promise.allSettled(Object.values(pending));
  const releases = await Promise.allSettled(
    sessions.flatMap((result) => (result.status === "fulfilled" ? [result.value.release()] : [])),
  );
  for (const result of releases) if (result.status === "rejected") throw result.reason;
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
      if (message.kind !== "bubble" && message.kind !== "text")
        throw new Error(`Unknown image task: ${message.kind}`);
      const result =
        message.kind === "bubble" ? await run_bubble(input, shape) : await run_text(input, shape);
      port.postMessage({ id: message.id, ...result }, [result.payload]);
    } catch (error) {
      port.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

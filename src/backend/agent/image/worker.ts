import { parentPort, workerData } from "node:worker_threads";
import { tensor_shape } from "../inference/channel";
import { infer, float, check_finite, type Ort, type OrtSession } from "../inference/ort";
import type { ImageWorkerConfig } from "./engine";
import type { ChannelHeader } from "../inference/channel";

// 父线程固定一个作业的模型和设备，Worker 独占其原生会话。
const config = workerData as ImageWorkerConfig;
const port = parentPort!;
const loaded = (await import(config.ort)) as Ort & { default?: Ort };
const ort = loaded.default ?? loaded;
let session: OrtSession | undefined;
let queue = Promise.resolve(); // close 在当前推理与张量释放之后执行。
type Request =
  | { type: "close" }
  | { type: "infer"; id: number; kind: string; header: ChannelHeader; payload: ArrayBuffer };
port.on("message", (message: Request) => {
  queue = queue.then(async () => {
    if (message.type === "close") {
      await session?.release();
      port.close();
      return;
    }
    try {
      const shape = tensor_shape(message.header, message.payload.byteLength);
      if (
        message.kind !== config.kind ||
        shape.length !== 4 ||
        shape[0] !== 1 ||
        shape[1] !== (config.kind === "shadow" ? 3 : 4)
      )
        throw new Error("Invalid image tensor");
      const input = new Float32Array(message.payload);
      check_finite(input);
      session ??= await ort.InferenceSession.create(config.file, {
        executionProviders: [config.device],
        intraOpNumThreads: 4,
        interOpNumThreads: 1,
        logSeverityLevel: 3,
      });
      const plane = shape[2]! * shape[3]!;
      const feeds =
        config.kind === "shadow"
          ? { [session.inputNames[0]!]: new ort.Tensor("float32", input, shape) }
          : {
              image: new ort.Tensor("float32", input.subarray(0, 3 * plane), [
                1,
                3,
                shape[2]!,
                shape[3]!,
              ]),
              mask: new ort.Tensor("float32", input.subarray(3 * plane), [
                1,
                1,
                shape[2]!,
                shape[3]!,
              ]),
            };
      const outputs = await infer(session, feeds);
      try {
        const names = config.kind === "shadow" ? ["output0", "output1"] : [session.outputNames[0]!];
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
        port.postMessage(
          {
            id: message.id,
            header: { shapes: tensors.map((tensor) => tensor.dims) },
            payload: data.buffer,
          },
          [data.buffer],
        );
      } finally {
        for (const tensor of Object.values(outputs)) tensor.dispose();
      }
    } catch (error) {
      port.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

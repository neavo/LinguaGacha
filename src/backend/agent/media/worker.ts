/**
 * 媒体推理 Worker：唯一导入 onnxruntime-node、创建与释放会话的位置。
 * 主线程直接加载 ORT 时，原生收尾可能在 `exit` 之后卡住进程；放在 Worker 内由宿主线程等待它自然退出。
 * 本入口由根脚本以文件 URL 启动，只用 Node 标准解析，不依赖工作区 SDK 钩子。
 */
import { performance } from "node:perf_hooks";
import { parentPort, workerData } from "node:worker_threads";
import { default_native_fs as fs } from "../../../native/native-fs";
import { tensor_shape } from "./channel";
import { ASR_LANGUAGE_IDS, ASR_TEXT_NORM, ctc_decode } from "./speech";
import type {
  MediaCalibration,
  MediaDevice,
  MediaTask,
  MediaWorkerConfig,
  MediaWorkerReply,
  MediaWorkerRequest,
} from "./worker-protocol";

/** 本模块使用的 onnxruntime-node 子集。 */
type OrtTensor = { readonly data: unknown; readonly dims: readonly number[]; dispose(): void };
type OrtSession = {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
};
type Ort = {
  InferenceSession: {
    create(file: string, options: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: Float32Array | Int32Array, dims: readonly number[]) => OrtTensor;
};

const VAD_CONTEXT = 3; // TEN-VAD 每次输入最近三帧特征。
const VAD_FEATURES = 41;
const VAD_STATE = [1, 64];
const CALIBRATION_ROUNDS = 3; // 预热一次后交替测量的轮数。
// 校准用实际最大形状：20 秒识别窗口与 16:9 画面的检测输入。
const CALIBRATION_SHAPES: Readonly<Record<Exclude<MediaTask, "vad">, readonly number[]>> = {
  asr: [1, 333, 560],
  det: [1, 3, 352, 640],
};

const config = workerData as MediaWorkerConfig;
const port = parentPort!;
const loaded = (await import(config.ort)) as Ort & { default?: Ort };
const ort: Ort = loaded.default ?? loaded;

/** 创建会话。WebGPU 不支持的算子回退 CPU，线程数同样生效。 */
function create(file: string, device: MediaDevice, threads: number): Promise<OrtSession> {
  return ort.InferenceSession.create(file, {
    executionProviders: [device],
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    logSeverityLevel: 3, // 只记录错误；算子分配到 CPU 的提示属于预期。
  });
}

const float = (data: unknown): Float32Array => {
  if (!(data instanceof Float32Array)) throw new Error("Model output is not float32.");
  return data;
};

/** GPU 输出可能因设备故障出现 NaN，必须当作失败而不是空结果。 */
function check_finite(data: Float32Array): void {
  for (const value of data)
    if (!Number.isFinite(value)) throw new Error("Model output is not finite.");
}

/** 运行一次，输入张量用后即释放。 */
async function infer(
  session: OrtSession,
  feeds: Record<string, OrtTensor>,
): Promise<Record<string, OrtTensor>> {
  try {
    return await session.run(feeds);
  } finally {
    for (const tensor of Object.values(feeds)) tensor.dispose();
  }
}

/** 识别：输出含四个控制位置，按有效长度解码，只回传 token 与时间。 */
async function recognize(
  session: OrtSession,
  vocabulary: readonly string[],
  input: Float32Array,
  shape: number[],
  language: string,
  device: MediaDevice,
) {
  const id = ASR_LANGUAGE_IDS[language];
  if (id === undefined) throw new Error(`Unsupported ASR language: ${language}`);
  const outputs = await infer(session, {
    speech: new ort.Tensor("float32", input, shape),
    speech_lengths: new ort.Tensor("int32", Int32Array.of(shape[1]!), [1]),
    language: new ort.Tensor("int32", Int32Array.of(id), [1]),
    textnorm: new ort.Tensor("int32", Int32Array.of(ASR_TEXT_NORM), [1]),
  });
  try {
    const logits = outputs.ctc_logits!;
    const data = float(logits.data);
    if (device !== "cpu") check_finite(data);
    const length = Number((outputs.encoder_out_lens!.data as ArrayLike<number | bigint>)[0]);
    if (logits.dims.length !== 3 || !(length > 0 && length <= logits.dims[1]!))
      throw new Error(`Unexpected ASR output: ${JSON.stringify(logits.dims)} / ${length}`);
    return ctc_decode(data, logits.dims[2]!, length, vocabulary);
  } finally {
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
}

/** 检测：回传概率图 [H, W]，后处理在 Python。 */
async function detect(
  session: OrtSession,
  input: Float32Array,
  shape: number[],
  device: MediaDevice,
): Promise<{ shape: number[]; data: Float32Array<ArrayBuffer> }> {
  const outputs = await infer(session, {
    [session.inputNames[0]!]: new ort.Tensor("float32", input, shape),
  });
  try {
    const output = outputs[session.outputNames[0]!]!;
    const data = new Float32Array(float(output.data)); // 复制到独立缓冲区再转移。
    if (device !== "cpu") check_finite(data);
    return { shape: output.dims.slice(-2), data };
  } finally {
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
}

/** 一路音频的 TEN-VAD 循环状态，按帧顺序推进。 */
type VadStream = { context: Float32Array; states: OrtTensor[] };

async function serve(): Promise<void> {
  const models = config.models!;
  const sessions = new Map<MediaTask, Promise<OrtSession>>();
  const streams = new Map<number, VadStream>();
  let vocabulary: string[] | undefined;
  const session = (task: MediaTask): Promise<OrtSession> => {
    let current = sessions.get(task);
    if (!current) {
      const { file, device, threads } = models[task];
      current = create(file, device, threads);
      sessions.set(task, current);
    }
    return current;
  };

  const vad = async (
    stream: number,
    input: Float32Array,
    rows: number,
  ): Promise<Float32Array<ArrayBuffer>> => {
    const model = await session("vad");
    let state = streams.get(stream);
    if (!state) {
      state = {
        context: new Float32Array(VAD_CONTEXT * VAD_FEATURES),
        states: model.inputNames
          .slice(1)
          .map(() => new ort.Tensor("float32", new Float32Array(64), VAD_STATE)),
      };
      streams.set(stream, state);
    }
    const probs = new Float32Array(rows);
    for (let row = 0; row < rows; row++) {
      state.context.copyWithin(0, VAD_FEATURES);
      state.context.set(
        input.subarray(row * VAD_FEATURES, (row + 1) * VAD_FEATURES),
        (VAD_CONTEXT - 1) * VAD_FEATURES,
      );
      const feeds: Record<string, OrtTensor> = {
        [model.inputNames[0]!]: new ort.Tensor("float32", state.context.slice(), [
          1,
          VAD_CONTEXT,
          VAD_FEATURES,
        ]),
      };
      model.inputNames.slice(1).forEach((name, index) => (feeds[name] = state.states[index]!));
      const outputs = await model.run(feeds); // 状态张量下一帧继续使用，不在此释放。
      probs[row] = float(outputs[model.outputNames[0]!]!.data)[0]!;
      state.states = model.outputNames.slice(1).map((name) => outputs[name]!);
    }
    return probs;
  };

  const handle = async (message: MediaWorkerRequest): Promise<MediaWorkerReply | undefined> => {
    if (message.type === "release") {
      streams.delete(message.stream);
      return undefined;
    }
    if (message.type === "close") return undefined;
    const { id, kind, header } = message;
    const device = models[kind].device;
    try {
      const input = new Float32Array(message.payload);
      const shape = tensor_shape(header, message.payload.byteLength);
      if (kind === "vad") {
        if (shape.length !== 2 || shape[1] !== VAD_FEATURES)
          throw new Error(`Unexpected VAD input: ${JSON.stringify(shape)}`);
        const probs = await vad(message.stream, input, shape[0]!);
        return { id, header: { dtype: "float32", shape: [probs.length] }, payload: probs.buffer };
      }
      if (kind === "asr") {
        if (shape.length !== 3) throw new Error(`Unexpected ASR input: ${JSON.stringify(shape)}`);
        vocabulary ??= read_vocabulary(config.tokens);
        const result = await recognize(
          await session("asr"),
          vocabulary,
          input,
          shape,
          String(header.language),
          device,
        );
        return { id, header: result };
      }
      if (shape.length !== 4)
        throw new Error(`Unexpected detection input: ${JSON.stringify(shape)}`);
      const result = await detect(await session("det"), input, shape, device);
      return { id, header: { dtype: "float32", shape: result.shape }, payload: result.data.buffer };
    } catch (error) {
      return { id, error: error instanceof Error ? error.message : String(error), device };
    }
  };

  // 原生推理本身同步执行，消息逐条排队，保证 VAD 状态按帧推进且 GPU 调用串行。
  let queue = Promise.resolve();
  port.on("message", (message: MediaWorkerRequest) => {
    queue = queue.then(async () => {
      const reply = await handle(message);
      if (reply)
        port.postMessage(reply, "payload" in reply && reply.payload ? [reply.payload] : []);
      if (message.type === "close") await shutdown(sessions);
    });
  });
}

/** 释放全部会话后关闭端口，事件循环排空即自然退出。 */
async function shutdown(sessions: Map<MediaTask, Promise<OrtSession>>): Promise<void> {
  const created = await Promise.allSettled(sessions.values());
  sessions.clear();
  for (const result of created) if (result.status === "fulfilled") await result.value.release();
  port.close();
}

/** tokens.txt 每行是 `<token> <id>`，token 本身可能含空格以外的任意字符。 */
function read_vocabulary(file: string): string[] {
  const vocabulary: string[] = [];
  for (const line of fs.read_text_file(file).split(/\r?\n/u)) {
    if (!line) continue;
    const split = line.lastIndexOf(" ");
    vocabulary[Number(line.slice(split + 1))] = line.slice(0, split);
  }
  return vocabulary;
}

/** 合成输入：确定性的有限值，只用于计时与可用性检查。 */
function synthetic(shape: readonly number[]): Float32Array {
  const data = new Float32Array(shape.reduce((total, value) => total * value, 1));
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.37);
  return data;
}

/**
 * 校准：同一 Worker 内对每项任务的 CPU 与 GPU 配置各预热一次，再交替测量。
 * 某个配置创建或运行失败只记录原因，不影响其它配置；最后释放全部会话。
 */
async function calibrate(): Promise<void> {
  const result: MediaCalibration = { asr: {}, det: {} };
  const vocabulary = read_vocabulary(config.tokens);
  const created: OrtSession[] = [];
  try {
    for (const task of ["det", "asr"] as const) {
      const shape = CALIBRATION_SHAPES[task];
      const input = synthetic(shape);
      const run = async (session: OrtSession, device: MediaDevice) => {
        if (task === "asr")
          await recognize(session, vocabulary, input.slice(), [...shape], "auto", device);
        else {
          const output = await detect(session, input.slice(), [...shape], device);
          if (output.shape.join() !== shape.slice(-2).join())
            throw new Error(`Unexpected detection output: ${output.shape}`);
        }
      };
      const ready: [MediaDevice, OrtSession][] = [];
      for (const [device, candidate] of Object.entries(config.calibrate![task]) as [
        MediaDevice,
        { file: string; threads: number },
      ][]) {
        try {
          const session = await create(candidate.file, device, candidate.threads);
          created.push(session);
          await run(session, device); // 预热，同时检查输出。
          ready.push([device, session]);
          result[task][device] = [];
        } catch (error) {
          result[task][device] = error instanceof Error ? error.message : String(error);
        }
      }
      for (let round = 0; round < CALIBRATION_ROUNDS; round++)
        for (const [device, session] of ready) {
          const timings = result[task][device];
          if (!Array.isArray(timings)) continue;
          const began = performance.now();
          try {
            await run(session, device);
            timings.push(performance.now() - began);
          } catch (error) {
            result[task][device] = error instanceof Error ? error.message : String(error);
          }
        }
    }
  } finally {
    for (const session of created) await session.release();
  }
  port.postMessage(result);
  port.close();
}

if (config.calibrate) await calibrate();
else await serve();

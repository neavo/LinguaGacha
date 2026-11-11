/**
 * 媒体推理 Worker：独占原生会话，避免同步推理阻塞根线程。
 * 本入口只使用 Node 标准解析，不依赖工作区 SDK 钩子。
 */
import { parentPort, workerData } from "node:worker_threads";
import { default_native_fs as fs } from "../../../native/native-fs";
import { tensor_shape } from "./channel";
import { ASR_LANGUAGE_IDS, ASR_TEXT_NORM, ctc_decode } from "./speech";
import type {
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

// FSMN 契约与 `fsmn_vad.py` 一致：LFR 400 维特征，每帧 248 个 pdf 得分。
const VAD_FEATURES = 400;
const VAD_PDFS = 248;
const VAD_BLOCK = 6000; // 单次请求的特征帧上限，沿用上游离线约 60 秒分块。
const VAD_STATE = [1, 128, 19, 1]; // 每个循环缓存的形状。
const VAD_CACHES = 4; // `in_cache0..3` 与 `out_cache0..3` 一一对应。
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
    logSeverityLevel: 3, // 只记录错误。算子分配到 CPU 的提示属于预期。
  });
}

/** 原生输出通过类型校验后才能交给解码与检测。 */
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
    check_finite(data);
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
): Promise<{ shape: number[]; data: Float32Array<ArrayBuffer> }> {
  const outputs = await infer(session, {
    [session.inputNames[0]!]: new ort.Tensor("float32", input, shape),
  });
  try {
    const output = outputs[session.outputNames[0]!]!;
    const data = new Float32Array(float(output.data)); // 复制到独立缓冲区再转移。
    if (output.dims.join() !== [1, 1, ...shape.slice(-2)].join())
      throw new Error(`Unexpected detection output: ${output.dims}`);
    check_finite(data);
    if (data.some((value) => value < 0 || value > 1))
      throw new Error("Detection output is not a probability map.");
    return { shape: output.dims.slice(-2), data };
  } finally {
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
}

/** 每路音频唯一拥有四个 FSMN 循环缓存。 */
type VadStream = OrtTensor[];

/** 每个 Worker 独占会话与 VAD 流状态，按消息顺序执行。 */
async function serve(): Promise<void> {
  const models = config.models;
  const sessions = new Map<MediaTask, Promise<OrtSession>>(); // 按任务首次请求时创建。
  const streams = new Map<number, VadStream>();
  let vocabulary: string[] | undefined; // ASR 首次请求时读取。
  /** 同一任务共用一个会话，并发首请求共享同一个创建过程。 */
  const session = (task: MediaTask): Promise<OrtSession> => {
    let current = sessions.get(task);
    if (!current) {
      const { file, device, threads } = models[task];
      current = create(file, device, threads);
      sessions.set(task, current);
    }
    return current;
  };

  /** 释放一路的全部缓存，重复释放空流无副作用。 */
  const release = (stream: number): void => {
    for (const tensor of streams.get(stream) ?? []) tensor.dispose();
    streams.delete(stream);
  };
  /** 一路首次请求从零缓存开始。成功后新缓存替换旧缓存，失败则丢弃该路状态。 */
  const vad = async (
    stream: number,
    input: Float32Array,
    rows: number,
  ): Promise<Float32Array<ArrayBuffer>> => {
    const model = await session("vad");
    let state = streams.get(stream);
    if (!state) {
      state = Array.from(
        { length: VAD_CACHES },
        () =>
          new ort.Tensor(
            "float32",
            new Float32Array(VAD_STATE.reduce((size, n) => size * n)),
            VAD_STATE,
          ),
      );
      streams.set(stream, state);
    }
    const speech = new ort.Tensor("float32", input, [1, rows, VAD_FEATURES]);
    let outputs: Record<string, OrtTensor> = {};
    const owned = new Set<OrtTensor>();
    try {
      outputs = await model.run({
        speech,
        ...Object.fromEntries(state.map((tensor, i) => [`in_cache${i}`, tensor])),
      });
      const logits = outputs.logits;
      if (Object.keys(outputs).length !== VAD_CACHES + 1)
        throw new Error("Unexpected FSMN output count.");
      if (!logits || logits.dims.join() !== [1, rows, VAD_PDFS].join())
        throw new Error("Unexpected FSMN logits shape.");
      check_finite(float(logits.data));
      const next = Array.from({ length: VAD_CACHES }, (_, i) => {
        const tensor = outputs[`out_cache${i}`];
        if (!tensor || tensor.dims.join() !== VAD_STATE.join())
          throw new Error("Unexpected FSMN cache shape.");
        check_finite(float(tensor.data));
        return tensor;
      });
      const result = new Float32Array(float(logits.data));
      release(stream);
      streams.set(stream, next);
      for (const tensor of next) owned.add(tensor);
      return result;
    } catch (error) {
      release(stream); // 失败不能留下半更新的流状态。
      throw error;
    } finally {
      speech.dispose();
      for (const tensor of Object.values(outputs)) if (!owned.has(tensor)) tensor.dispose();
    }
  };

  /** 推理请求总有应答，模型错误转为失败应答。释放与关闭消息没有应答。 */
  const handle = async (message: MediaWorkerRequest): Promise<MediaWorkerReply | undefined> => {
    if (message.type === "release") {
      release(message.stream);
      return undefined;
    }
    if (message.type === "close") return undefined;
    const { id, kind, header } = message;
    try {
      const input = new Float32Array(message.payload);
      const shape = tensor_shape(header, message.payload.byteLength);
      if (kind === "vad") {
        if (
          shape.length !== 3 ||
          shape[0] !== 1 ||
          shape[2] !== VAD_FEATURES ||
          shape[1]! < 1 ||
          shape[1]! > VAD_BLOCK
        )
          throw new Error(`Unexpected VAD input: ${JSON.stringify(shape)}`);
        const probs = await vad(message.stream, input, shape[1]!);
        return {
          id,
          header: { dtype: "float32", shape: [1, shape[1]!, VAD_PDFS] },
          payload: probs.buffer,
        };
      }
      if (kind === "asr") {
        if (shape.length !== 3) throw new Error(`Unexpected ASR input: ${JSON.stringify(shape)}`);
        vocabulary ??= read_vocabulary(config.tokens);
        const model = await session("asr");
        const result = await recognize(model, vocabulary, input, shape, String(header.language));
        return {
          id,
          header: result,
        };
      }
      if (shape.length !== 4)
        throw new Error(`Unexpected detection input: ${JSON.stringify(shape)}`);
      const result = await detect(await session("det"), input, shape);
      return { id, header: { dtype: "float32", shape: result.shape }, payload: result.data.buffer };
    } catch (error) {
      return { id, error: error instanceof Error ? error.message : String(error) };
    }
  };

  // 原生推理本身同步执行，消息逐条排队，保证 VAD 状态按帧推进且 GPU 调用串行。
  let queue = Promise.resolve();
  port.on("message", (message: MediaWorkerRequest) => {
    queue = queue.then(async () => {
      const reply = await handle(message);
      if (reply)
        port.postMessage(reply, "payload" in reply && reply.payload ? [reply.payload] : []);
      if (message.type === "close") {
        for (const stream of streams.keys()) release(stream);
        await shutdown(sessions);
      }
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

await serve();

/**
 * 一次计算操作的资源所有权：根线程持有 Python helper 与推理 Worker，桥接两者的请求，
 * 等全部资源退出后才返回结果。GPU 配置在运行中出错时，整次操作以 CPU 重跑一次。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { default_native_fs as fs } from "../../../native/native-fs";
import { npm } from "../npm";
import { npm_configuration } from "../npm/runtime";
import { uv } from "../uv";
import { encode_frame, FrameReader, type ChannelHeader } from "./channel";
import { MEDIA_MODELS, model_ready } from "./models";
import type {
  MediaCalibration,
  MediaDevice,
  MediaTask,
  MediaWorkerConfig,
  MediaWorkerReply,
  MediaWorkerRequest,
} from "./worker-protocol";

export const ORT_PACKAGE = "onnxruntime-node";
export const ORT_VERSION = "1.31.1"; // 经过 Worker 生命周期与 WebGPU 验证的版本。
const EXIT_TIMEOUT_MS = 30_000; // Worker 释放会话后自然退出的等待上限。
const GPU_GAIN = 0.15; // GPU 稳定耗时至少快这么多才采用，防止测量噪声。
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000; // 取不到驱动身份，配置定期重测。
const CONFIG_VERSION = 1; // 线程与队列配置变化时递增，使本机缓存失效。
// 每个会话的线程数；Worker 划分见 `lane_of`，其余核心留给同时运行的 ffmpeg 与 Python。
const CPU_THREADS: Readonly<Record<MediaTask, number>> = { vad: 1, asr: 4, det: 4 };
const GPU_FALLBACK_THREADS = 4; // WebGPU 不支持的算子回退 CPU 时的线程数。

type Profile = Readonly<Record<"asr" | "det", MediaDevice>>;
const CPU_PROFILE: Profile = { asr: "cpu", det: "cpu" };
type InferenceCache = Readonly<
  Profile & {
    key: string;
    expires: number;
    webgpu: boolean; // 本机 WebGPU 能创建并运行检测会话，据此决定是否准备 GPU 权重。
    reasons: Readonly<Record<string, string>>;
    calibration: MediaCalibration;
  }
>;

/** 共享 npm 工程同级的应用数据目录：模型与可重建的本机运行缓存。 */
export function media_directories(): { models: string; runtime: string } {
  const root = path.resolve(npm.directory, "..");
  return { models: path.join(root, "models"), runtime: path.join(root, "media") };
}

const model_file = (model: { file: string }): string =>
  path.join(media_directories().models, model.file);
const runtime_file = (name: string): string =>
  path.join(npm_configuration().runtimeDirectory, "runtime", name);

/**
 * 共享 npm 工程中 ORT 的实际入口。只解析路径，根线程不得加载原生库：
 * 原生收尾可能在 `exit` 之后卡住进程，所有导入与会话都在 Worker 内。
 */
function ort_entry(): string {
  const root = path.join(npm.directory, "node_modules", ORT_PACKAGE);
  const entry = createRequire(path.join(npm.directory, "package.json")).resolve(ORT_PACKAGE);
  const relative = path.relative(root, entry);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`${ORT_PACKAGE} resolved outside the shared npm project: ${entry}`);
  return pathToFileURL(entry).href;
}

/** 运行中 GPU 会话失败。`task` 缺失表示无法归因到单项任务。 */
export class DeviceFailure extends Error {
  constructor(
    message: string,
    readonly task: "asr" | "det" | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * 原生推理在 Worker 线程内同步执行，同一 Worker 的请求天然串行。
 * GPU 任务共用一个 Worker，避免并发调用同一设备。CPU 上音频一路；检测在混合大小核上
 * 超过 6 线程几乎不再提速，改为两路 4 线程会话轮流处理，与 helper 的在途请求数一致。
 */
const CPU_DET_LANES = 2;
type Lane = string;
const lane_of = (task: MediaTask, profile: Profile, id: number): Lane =>
  task !== "vad" && profile[task] === "webgpu"
    ? "gpu"
    : task === "det"
      ? `det${id % CPU_DET_LANES}`
      : "audio";

/** 一次计算所用的推理 Worker，按通道在首次请求时启动。任一 Worker 故障后全部关闭，后续请求直接失败。 */
class Engine {
  private readonly config: MediaWorkerConfig;
  private readonly workers = new Map<Lane, Readonly<{ worker: Worker; exited: Promise<number> }>>();
  private readonly pending = new Map<
    number,
    Readonly<{ kind: MediaTask; resolve: (reply: Reply) => void; reject: (error: Error) => void }>
  >();
  private next = 0;
  private streams = 0;
  private failure: Error | undefined;
  private closing: Promise<void> | undefined;

  constructor(readonly profile: Profile) {
    const asr = profile.asr === "webgpu" ? MEDIA_MODELS.asr_gpu : MEDIA_MODELS.asr_cpu;
    // 各 Worker 共用同一份配置，只为收到的任务创建会话。
    this.config = {
      ort: ort_entry(),
      tokens: model_file(MEDIA_MODELS.tokens),
      models: {
        vad: { file: model_file(MEDIA_MODELS.vad), device: "cpu", threads: CPU_THREADS.vad },
        asr: { file: model_file(asr), device: profile.asr, threads: threads(profile.asr, "asr") },
        det: {
          file: model_file(MEDIA_MODELS.det),
          device: profile.det,
          threads: threads(profile.det, "det"),
        },
      },
    };
    console.log(`媒体推理配置：识别 ${profile.asr}，检测 ${profile.det}`);
  }

  private worker(lane: Lane): Worker {
    let current = this.workers.get(lane);
    if (!current) {
      const worker = new Worker(runtime_file("media-worker.mjs"), { workerData: this.config });
      const exited = new Promise<number>((resolve) => worker.once("exit", resolve));
      worker.on("message", (reply: MediaWorkerReply) => this.settle(reply));
      worker.on("error", (error) => this.fail(this.attribute(lane, undefined, error)));
      void exited.then((code) =>
        this.fail(
          this.attribute(lane, undefined, new Error(`Media inference worker exited (${code}).`)),
        ),
      );
      current = { worker, exited };
      this.workers.set(lane, current);
    }
    return current.worker;
  }

  get failed(): boolean {
    return this.failure !== undefined;
  }

  open(): number {
    return this.streams++;
  }

  /** helper 结束后丢弃它的 VAD 循环状态。 */
  release(stream: number): void {
    if (!this.failed) this.workers.get("audio")?.worker.postMessage({ type: "release", stream });
  }

  /** 载荷所在的 ArrayBuffer 转移给 Worker，调用者之后不能再使用它。 */
  request(
    stream: number,
    kind: MediaTask,
    header: ChannelHeader,
    payload: Uint8Array<ArrayBuffer>,
  ): Promise<Reply> {
    if (this.failure) return Promise.reject(this.failure);
    if (payload.byteOffset !== 0 || payload.byteLength !== payload.buffer.byteLength)
      throw new Error("Media payload must own its buffer.");
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { kind, resolve, reject });
      const message: MediaWorkerRequest = {
        type: "infer",
        id,
        stream,
        kind,
        header,
        payload: payload.buffer,
      };
      this.worker(lane_of(kind, this.profile, id)).postMessage(message, [payload.buffer]);
    });
  }

  /** 关闭只发生一次：请求释放会话，等待线程自然退出。超时说明原生收尾卡住，只能交给工作区监管器。 */
  close(): Promise<void> {
    this.closing ??= (async () => {
      const close: MediaWorkerRequest = { type: "close" };
      for (const { worker } of this.workers.values()) worker.postMessage(close); // 已退出的 Worker 忽略消息。
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), EXIT_TIMEOUT_MS);
      });
      const outcome = await Promise.race([
        Promise.all([...this.workers.values()].map(({ exited }) => exited)),
        timeout,
      ]);
      clearTimeout(timer);
      if (outcome === "timeout") {
        if (this.profile.asr !== "cpu" || this.profile.det !== "cpu")
          await forget_devices(undefined, "worker did not exit after releasing sessions");
        throw new Error(
          `Media inference worker did not exit within ${EXIT_TIMEOUT_MS / 1000}s; the host must end this run.`,
        );
      }
    })();
    return this.closing;
  }

  private settle(reply: MediaWorkerReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return this.fail(new Error(`Unknown media worker reply: ${reply.id}`));
    this.pending.delete(reply.id);
    if ("error" in reply) {
      const error = this.attribute(
        lane_of(pending.kind, this.profile, reply.id),
        pending.kind,
        new Error(reply.error),
      );
      pending.reject(error);
      if (error instanceof DeviceFailure) this.fail(error);
    } else pending.resolve(reply);
  }

  /** GPU 通道上的错误按设备失败处理，可归因时记录到具体任务；CPU 错误保持原样。 */
  private attribute(lane: Lane, kind: MediaTask | undefined, error: Error): Error {
    if (lane !== "gpu") return error;
    const task = kind === "asr" || kind === "det" ? kind : undefined;
    return new DeviceFailure(error.message, task, { cause: error });
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    // 等待者在获取或释放引擎时各自收到关闭结果，这里只避免未处理的拒绝。
    this.close().catch(() => undefined);
  }
}
type Reply = Readonly<{ header: ChannelHeader; payload?: ArrayBuffer }>;

const threads = (device: MediaDevice, task: MediaTask): number =>
  device === "cpu" ? CPU_THREADS[task] : GPU_FALLBACK_THREADS;

let shared: { engine: Engine; users: number } | undefined; // 同一根进程中并发的操作共用一个 Worker。
let gate: Promise<unknown> = Promise.resolve(); // 串行创建与替换 Worker。
let cpu_only = false; // 本进程发生过设备故障后不再尝试 GPU。

function acquire(): Promise<Engine> {
  const next = gate.then(async () => {
    if (shared && !shared.engine.failed) {
      shared.users++;
      return shared.engine;
    }
    // 故障的 Worker 退出后才能启动新的，不能在同一宿主里留下旧线程。
    if (shared) await shared.engine.close();
    const profile = cpu_only ? CPU_PROFILE : await inference_profile();
    shared = { engine: new Engine(profile), users: 1 };
    return shared.engine;
  });
  gate = next.catch(() => undefined); // 失败只交给本次调用者，后续调用重新尝试。
  return next;
}

async function release(engine: Engine): Promise<void> {
  if (shared?.engine !== engine) return engine.close();
  if (--shared.users > 0) return;
  shared = undefined;
  await engine.close();
}

/** 在共享 Worker 上执行一次计算操作；GPU 故障时废弃本轮结果，以 CPU 重跑一次。 */
export async function operate<T>(action: (engine: Engine) => Promise<T>): Promise<T> {
  let first: DeviceFailure | undefined;
  for (;;) {
    const engine = await acquire();
    try {
      return await action(engine);
    } catch (error) {
      if (first)
        throw new Error(`CPU rerun failed after a GPU failure (${first.message}).`, {
          cause: error,
        });
      if (!(error instanceof DeviceFailure)) throw error;
      first = error;
      cpu_only = true;
      await forget_devices(error.task, error.message);
      console.warn(`媒体推理的 GPU 配置失败，结束本轮计算并改用 CPU 重新执行：${error.message}`);
    } finally {
      await release(engine);
    }
  }
}

let synced: Promise<void> | undefined; // 每个根进程同步一次共享 Python 环境。

/** 共享 uv 工程 `.venv` 中的解释器。不使用 PATH 中的 Python，也不在 Worker 中安装依赖。 */
async function python(): Promise<string> {
  synced ??= uv.run(["sync", "--inexact"]).catch((error: unknown) => {
    synced = undefined;
    throw error;
  });
  await synced;
  const executable = path.join(
    uv.directory,
    ".venv",
    ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]),
  );
  if (!fs.exists(executable)) throw new Error(`Python interpreter is missing: ${executable}`);
  return executable;
}

/**
 * 运行 `media.py` 的一个命令。helper 的推理请求转发给 Worker，应答按编号写回。
 * 正常返回要求收到结果帧、helper 正常退出；任一请求失败时结束 helper 并抛出该失败。
 */
export async function helper(
  command: string,
  job: Readonly<Record<string, unknown>>,
  engine?: Engine,
): Promise<unknown> {
  // -I 忽略 PYTHON* 变量与用户 site，-X utf8 让日志在任何代码页下都是 UTF-8。
  const child = spawn(await python(), ["-I", "-X", "utf8", runtime_file("media.py")], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const stream = engine?.open();
  const reader = new FrameReader();
  let result: { value: unknown } | undefined, failure: unknown;
  const fail = (error: unknown): void => {
    failure ??= error;
    child.kill();
  };
  const write = (header: ChannelHeader, payload?: ArrayBuffer): void => {
    if (child.stdin.writable)
      for (const part of encode_frame(header, payload && new Uint8Array(payload)))
        child.stdin.write(part);
  };
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  child.once("error", fail);
  // helper 提前退出时写入会报 EPIPE，真实原因由退出码或已记录的失败说明。
  child.stdin.on("error", () => undefined);
  child.stdout.on("data", (chunk: Buffer) => {
    try {
      for (const { header, payload } of reader.push(chunk)) {
        if ("result" in header) {
          result = { value: JSON.parse(Buffer.from(payload).toString("utf8")) };
          child.stdin.end(); // helper 的读线程随 EOF 结束后自然退出。
          continue;
        }
        const { id, kind } = header;
        if (!engine || (kind !== "vad" && kind !== "asr" && kind !== "det"))
          throw new Error(`Unexpected media helper request: ${JSON.stringify(header)}`);
        engine
          .request(stream!, kind, header, payload)
          .then((reply) => write({ ...reply.header, id }, reply.payload), fail);
      }
    } catch (error) {
      fail(error);
    }
  });
  write({ command, args: job });
  const code = await closed;
  if (stream !== undefined) engine!.release(stream);
  if (failure === undefined)
    try {
      reader.end();
    } catch (error) {
      failure = error;
    }
  if (failure !== undefined) throw failure;
  if (code !== 0 || !result) throw new Error(`media.py ${command} failed (${code}); see the log.`);
  return result.value;
}

/** 本机配置缓存键：平台、运行时、ORT、模型与配置版本任一变化都需重测。 */
function cache_key(): string {
  return JSON.stringify([
    process.platform,
    process.arch,
    process.versions.electron ?? process.versions.node,
    ORT_VERSION,
    CONFIG_VERSION,
    MEDIA_MODELS.asr_cpu.sha256,
    MEDIA_MODELS.asr_gpu.sha256,
    MEDIA_MODELS.det.sha256,
  ]);
}

const cache_path = (): string => path.join(media_directories().runtime, "inference.json");

/** 有效的本机配置缓存。缺失、过期或损坏都视为没有缓存，由下次校准覆盖。 */
export async function inference_cache(): Promise<InferenceCache | undefined> {
  let value: InferenceCache;
  try {
    value = JSON.parse(fs.read_text_file(cache_path())) as InferenceCache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError)
      return undefined;
    throw error;
  }
  return value?.key === cache_key() && value.expires > Date.now() ? value : undefined;
}

function write_cache(cache: InferenceCache): void {
  fs.ensure_parent_dir(cache_path());
  fs.write_file_atomic(cache_path(), JSON.stringify(cache, null, 2));
}

/** 运行时设备错误只让对应任务改用 CPU，其它任务的选择保留。 */
async function forget_devices(task: "asr" | "det" | undefined, reason: string): Promise<void> {
  const cache = await inference_cache();
  if (!cache) return;
  const tasks = task ? [task] : (["asr", "det"] as const);
  write_cache({
    ...cache,
    ...Object.fromEntries(tasks.map((name) => [name, "cpu"])),
    reasons: { ...cache.reasons, ...Object.fromEntries(tasks.map((name) => [name, reason])) },
  });
}

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[values.length >> 1]!;

/** CPU 基线有效且 GPU 稳定耗时至少快 GPU_GAIN 才选 GPU。 */
export function choose(
  cpu: number[] | string | undefined,
  gpu: number[] | string | undefined,
): MediaDevice {
  if (!Array.isArray(cpu) || !cpu.length || !Array.isArray(gpu) || !gpu.length) return "cpu";
  return median(gpu) <= median(cpu) * (1 - GPU_GAIN) ? "webgpu" : "cpu";
}

async function inference_profile(): Promise<Profile> {
  return (await inference_cache()) ?? (await calibrate_devices());
}

/**
 * 在专用 Worker 中测量各任务的 CPU 与 WebGPU 配置并写入本机缓存。
 * GPU 权重尚未下载时只测检测，据此判断是否值得准备 GPU 权重。
 * Worker 正常退出后才写入 GPU 结论；退出超时则记录为 CPU 并报错。
 */
export async function calibrate_devices(): Promise<InferenceCache> {
  const { models } = media_directories();
  const gpu_asr = model_ready(models, MEDIA_MODELS.asr_gpu);
  const candidate = (model: { file: string }, device: MediaDevice, task: MediaTask) => ({
    file: model_file(model),
    threads: threads(device, task),
  });
  const config: MediaWorkerConfig = {
    ort: ort_entry(),
    tokens: model_file(MEDIA_MODELS.tokens),
    calibrate: {
      asr: {
        cpu: candidate(MEDIA_MODELS.asr_cpu, "cpu", "asr"),
        ...(gpu_asr ? { webgpu: candidate(MEDIA_MODELS.asr_gpu, "webgpu", "asr") } : {}),
      },
      det: {
        cpu: candidate(MEDIA_MODELS.det, "cpu", "det"),
        webgpu: candidate(MEDIA_MODELS.det, "webgpu", "det"),
      },
    },
  };
  console.log("正在测量本机媒体推理配置");
  const worker = new Worker(runtime_file("media-worker.mjs"), { workerData: config });
  const exited = new Promise<number>((resolve) => worker.once("exit", resolve));
  const calibration = await new Promise<MediaCalibration>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    void exited.then((code) => reject(new Error(`Media calibration worker exited (${code}).`)));
  });
  let timer: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([
    exited,
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), EXIT_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  const reasons: Record<string, string> = {};
  for (const task of ["asr", "det"] as const)
    for (const [device, value] of Object.entries(calibration[task]))
      if (typeof value === "string") reasons[`${task}:${device}`] = value;
  const timed_out = outcome === "timeout";
  if (timed_out) reasons.exit = "calibration worker did not exit";
  const cache: InferenceCache = {
    key: cache_key(),
    expires: Date.now() + CACHE_TTL_MS,
    webgpu: !timed_out && Array.isArray(calibration.det.webgpu),
    asr: timed_out ? "cpu" : choose(calibration.asr.cpu, calibration.asr.webgpu),
    det: timed_out ? "cpu" : choose(calibration.det.cpu, calibration.det.webgpu),
    reasons,
    calibration,
  };
  write_cache(cache);
  if (timed_out)
    throw new Error(
      "Media calibration worker did not exit; CPU is now selected and the host must end this run.",
    );
  console.log(`媒体推理配置：识别 ${cache.asr}，检测 ${cache.det}`);
  return cache;
}

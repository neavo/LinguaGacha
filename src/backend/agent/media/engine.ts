/**
 * 一次计算操作的资源所有权：根线程持有 Python helper 与推理 Worker，桥接两者的请求，
 * 等全部资源退出后才返回结果。GPU 配置在运行中出错时，整次操作以 CPU 重跑一次。
 */
import lockfile from "proper-lockfile";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CLOSE_TIMEOUT_MS, Engine, DeviceFailure } from "./inference-engine";
import { CalibrationCleanupFailure, run_calibration, select_device } from "./calibration";
import { default_native_fs as fs } from "../../../native/native-fs";
import { npm } from "../npm";
import { media_configuration, MEDIA_PREPARE_LOCK_RETRY } from "./runtime";
import { uv } from "../uv";
import { encode_frame, FrameReader, type ChannelHeader } from "./channel";
import { MEDIA_MODELS, model_ready } from "./models";
import type {
  DeviceOptions,
  MediaResult,
  MediaMeasurement,
  MediaDevice,
  MediaWorkerConfig,
} from "./worker-protocol";

export const ORT_PACKAGE = "onnxruntime-node";
export const ORT_VERSION = "1.31.1";
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000; // 缓存键不含驱动版本，定期重新检查设备。
const CONFIG_VERSION = 5; // 选型规则或运行配置变化时使旧缓存失效。
/** 只保存默认设备和选择依据，显式纠错不写入这里。 */
type InferenceCache = Readonly<{
  key: string;
  expires: number;
  device: "cpu" | "gpu";
  reason: string;
  cpu: MediaMeasurement;
  gpu?: MediaMeasurement;
}>;

/** 设备来自 AGENT 脚本，未知值必须在资源准备前拒绝。 */
export function validate_device(device: DeviceOptions["device"]): void {
  if (device !== undefined && device !== "cpu" && device !== "gpu")
    throw new Error("Media device must be cpu or gpu.");
}

/** 读取本机可重建的 JSON 缓存。缺失或损坏都按没有处理，由下次写入覆盖。 */
export function read_json(file: string): unknown {
  try {
    return JSON.parse(fs.read_text_file(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError)
      return undefined;
    throw error;
  }
}

const model_file = (model: { file: string }): string =>
  path.join(media_configuration().modelsDirectory, model.file);
export const runtime_file = (name: string): string =>
  path.join(media_configuration().runtimeDirectory, "runtime", name);

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

// 无法确认旧资源已退出时，监管器必须结束本次运行，后续调用不能再创建资源。
let shutdown_failure: unknown;

/** 每次调用拥有自己的引擎。设备覆盖和故障不改变并行调用的配置。 */
export async function operate<T>(
  action: (engine: Engine) => Promise<T>,
  task: "asr" | "det",
  { device }: DeviceOptions = {},
): Promise<MediaResult<T>> {
  validate_device(device);
  let first: DeviceFailure | undefined;
  const cache = await inference_cache();
  let actual = device ?? cache?.device ?? "cpu";
  const gpu_model = task === "asr" ? MEDIA_MODELS.asr_gpu : MEDIA_MODELS.det_gpu;
  let reason: string | undefined;
  if (actual === "gpu" && !model_ready(media_configuration().modelsDirectory, gpu_model)) {
    if (device === "gpu")
      throw new Error(
        `GPU model missing; call media.setup(["${task === "asr" ? "speech" : "text"}"], { device: "gpu" }) first.`,
      );
    actual = "cpu";
    reason = "GPU model is missing.";
  }
  for (;;) {
    if (shutdown_failure) throw shutdown_failure;
    const engine = new Engine(
      worker_config(actual === "gpu" ? "webgpu" : "cpu"),
      runtime_file("media-worker.mjs"),
    );
    try {
      const result = await action(engine);
      return {
        result,
        execution: {
          requested: device ?? "auto",
          actual,
          ...(reason ? { fallback_reason: reason } : {}),
        },
      };
    } catch (error) {
      if (first)
        throw new Error(`CPU rerun failed after a GPU failure (${first.message}).`, {
          cause: error,
        });
      if (!(error instanceof DeviceFailure) || actual === "cpu") throw error;
      first = error;
      actual = "cpu";
      reason = error.message;
      console.warn(`媒体推理 GPU 失败，回收后以 CPU 重跑：${reason}`);
    } finally {
      await close_engine(engine);
    }
    // 旧资源完全退出后才更新默认值。显式设备失败不影响下一次自动选择。
    if (device === undefined && cache) await disable_gpu(cache, first!.message);
  }
}

/** 退出失败使本次运行不可继续，保留故障供监管器收尾。 */
async function close_engine(engine: Engine): Promise<void> {
  try {
    await engine.close();
  } catch (error) {
    shutdown_failure = error;
    throw error;
  }
}

let synced: Promise<void> | undefined; // 每个根进程同步一次共享 Python 环境。

/** 共享 uv 工程 `.venv` 中的解释器。不使用 PATH 中的 Python，也不在 Worker 中安装依赖。 */
export async function python(): Promise<string> {
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
  let stopping: NodeJS.Timeout | undefined;
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
        if ("error" in header) {
          fail(new Error(String(header.error)));
          continue;
        }
        if ("result" in header) {
          result = { value: JSON.parse(Buffer.from(payload).toString("utf8")) };
          child.stdin.end(); // helper 的读线程随 EOF 结束后自然退出。
          continue;
        }
        const { id, kind } = header;
        if (!engine || (kind !== "vad" && kind !== "asr" && kind !== "det"))
          throw new Error(`Unexpected media helper request: ${JSON.stringify(header)}`);
        engine.request(stream!, kind, header, payload).then(
          (reply) => write({ ...reply.header, id }, reply.payload),
          (error: unknown) => {
            failure ??= error;
            write({ id, error: error instanceof Error ? error.message : String(error) });
            // 先让 Python 的 finally 回收 FFmpeg，再等待 helper 退出。
            stopping ??= setTimeout(() => {
              shutdown_failure = new Error(
                "Media helper did not close; the host must end this run.",
                { cause: failure },
              );
              child.kill();
            }, CLOSE_TIMEOUT_MS);
          },
        );
      }
    } catch (error) {
      fail(error);
    }
  });
  write({ command, args: job });
  const code = await closed;
  clearTimeout(stopping);
  if (shutdown_failure) throw shutdown_failure;
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
    process.versions.electron,
    process.versions.node,
    ORT_VERSION,
    CONFIG_VERSION,
    MEDIA_MODELS.asr_cpu.sha256,
    MEDIA_MODELS.asr_gpu.sha256,
    MEDIA_MODELS.det_cpu.sha256,
    MEDIA_MODELS.det_gpu.sha256,
  ]);
}

const cache_path = (): string => path.join(media_configuration().cacheDirectory, "inference.json");

/** 有效的本机配置缓存。缺失、过期或损坏都视为没有缓存，由下次校准覆盖。 */
export async function inference_cache(): Promise<InferenceCache | undefined> {
  const value = read_json(cache_path()) as InferenceCache | undefined;
  return value?.key === cache_key() &&
    value.expires > Date.now() &&
    ["cpu", "gpu"].includes(value.device)
    ? value
    : undefined;
}

/** 原子发布缓存，读取方不会看到半写入的文件。 */
function write_cache(cache: InferenceCache): void {
  fs.ensure_parent_dir(cache_path());
  fs.write_file_atomic(cache_path(), JSON.stringify(cache, null, 2));
}

/** 与 setup 共用准备锁，运行失败不能覆盖另一进程刚发布的新配置。 */
async function disable_gpu(previous: InferenceCache, reason: string): Promise<void> {
  const release = await lockfile.lock(path.join(media_configuration().cacheDirectory, "prepare"), {
    realpath: false,
    retries: MEDIA_PREPARE_LOCK_RETRY,
  });
  try {
    const current = await inference_cache();
    if (current?.key === previous.key && current.expires === previous.expires)
      write_cache({ ...current, device: "cpu", reason });
  } finally {
    await release();
  }
}

/** 配置与路径在父进程解析，执行核心和校准子进程不访问共享环境绑定。 */
function worker_config(device: MediaDevice): MediaWorkerConfig {
  const model = (key: keyof typeof MEDIA_MODELS, device: "cpu" | "webgpu", threads = 4) => ({
    file: model_file(MEDIA_MODELS[key]),
    device,
    threads,
  });
  return {
    ort: ort_entry(),
    tokens: model_file(MEDIA_MODELS.tokens),
    models: {
      vad: model("vad", "cpu", 1),
      asr: model(device === "cpu" ? "asr_cpu" : "asr_gpu", device),
      det: model(device === "cpu" ? "det_cpu" : "det_gpu", device),
    },
  };
}

/** 单一语音基准，CPU/GPU 各执行一次。调用方持有准备锁。 */
export async function calibrate_devices(): Promise<void> {
  const measure = (device: MediaDevice) =>
    run_calibration(runtime_file("media-calibrate.mjs"), {
      config: worker_config(device),
      worker: runtime_file("media-worker.mjs"),
    });
  console.log("媒体检查：CPU 执行一次 20 秒语音输入，等待进程退出");
  const cpu = await measure("cpu");
  console.log(
    `媒体检查 CPU：准备 ${cpu.prepare.toFixed(0)} ms，推理 ${cpu.inference.toFixed(0)} ms，关闭 ${cpu.close.toFixed(0)} ms`,
  );
  let gpu: MediaMeasurement | undefined;
  let reason = "GPU 推理耗时未降低至少 30%，使用 CPU。";
  try {
    console.log("媒体检查：GPU 执行一次相同输入，等待进程退出");
    gpu = await measure("webgpu");
    console.log(
      `媒体检查 GPU：准备 ${gpu.prepare.toFixed(0)} ms，推理 ${gpu.inference.toFixed(0)} ms，关闭 ${gpu.close.toFixed(0)} ms`,
    );
  } catch (error) {
    if (error instanceof CalibrationCleanupFailure) throw error;
    reason = error instanceof Error ? error.message : String(error);
  }
  const device = select_device(cpu, gpu);
  if (device === "gpu") reason = "GPU 推理耗时降低至少 30%。";
  write_cache({
    key: cache_key(),
    expires: Date.now() + CACHE_TTL_MS,
    device,
    reason,
    cpu,
    ...(gpu ? { gpu } : {}),
  });
  console.log(`媒体默认设备：${device}。${reason}`);
}

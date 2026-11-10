/**
 * 一次计算操作的资源所有权：根线程持有 Python helper 与推理 Worker，桥接两者的请求，
 * 等全部资源退出后才返回结果。GPU 配置在运行中出错时，整次操作以 CPU 重跑一次。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CLOSE_TIMEOUT_MS, Engine, DeviceFailure } from "./inference-engine";
import { CalibrationCleanupFailure, run_calibration, select_profile } from "./calibration";
import { default_native_fs as fs } from "../../../native/native-fs";
import { npm } from "../npm";
import { media_configuration } from "./runtime";
import { uv } from "../uv";
import { encode_frame, FrameReader, type ChannelHeader } from "./channel";
import { MEDIA_MODELS, model_ready } from "./models";
import type {
  MediaCalibration,
  MediaMeasurement,
  MediaProfile,
  MediaWorkerConfig,
} from "./worker-protocol";

/** helper 报告的 FFmpeg 解码失败，调用者据此改用软件解码重跑。 */
export class DecodeFailure extends Error {}

export const ORT_PACKAGE = "onnxruntime-node";
export const ORT_VERSION = "1.31.1"; // 经过 Worker 生命周期与 WebGPU 验证的版本。
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000; // 缓存键未覆盖硬件与驱动变化，定期在准备阶段重新测量。
const CONFIG_VERSION = 4; // 线程、路由、前处理或选择规则变化时递增，使旧缓存失效。
const CALIBRATION_LAUNCHES = 2; // 完整候选、独立进程退出和双档计时共同决定配置。
const CPU_PROFILE: MediaProfile = { asr: "cpu", det: "cpu" };
/** 已选配置与选择依据。`complete` 只列出准备完成的任务，其余任务下次准备时重试。 */
type InferenceCache = Readonly<
  Partial<MediaProfile> & {
    key: string;
    expires: number;
    complete: readonly ("asr" | "det")[];
    reasons: Readonly<Record<string, string>>;
    calibration: MediaCalibration;
    mixed?: Readonly<{ profile: MediaProfile; measurement: MediaMeasurement }>;
  }
>;

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

/** 并发操作共用的引擎。最后一个使用者负责关闭，`drained` 在关闭完成后兑现。 */
type SharedEngine = { engine: Engine; users: number; drained: Promise<void>; drain: () => void };
let shared: SharedEngine | undefined; // 所有 helper 关闭后，最后一个使用者释放引擎。
let gate: Promise<unknown> = Promise.resolve(); // 串行创建引擎。
let cpu_only = false; // 本进程出现过 GPU 故障后不再使用 GPU。
let shutdown_failure: unknown; // 无法确认资源退出时记录，之后的操作一律失败。

/** 复用仍健康的共享引擎，否则等旧引擎关闭后按当前配置新建。 */
function acquire(): Promise<Engine> {
  const next = gate.then(async () => {
    if (shutdown_failure) throw shutdown_failure;
    if (shared && shared.users > 0 && !shared.engine.failed) {
      shared.users++;
      return shared.engine;
    }
    // 故障重跑同时等待其他操作的 helper，避免旧进程继续写文件。
    if (shared) await shared.drained;
    if (shutdown_failure) throw shutdown_failure;
    const profile = cpu_only ? CPU_PROFILE : await inference_profile();
    let drain!: () => void;
    const drained = new Promise<void>((resolve) => {
      drain = resolve;
    });
    shared = {
      engine: new Engine(profile, worker_config(profile), runtime_file("media-worker.mjs")),
      users: 1,
      drained,
      drain,
    };
    return shared.engine;
  });
  gate = next.catch(() => undefined); // 本次失败由等待者处理，创建队列仍须能继续排空。
  return next;
}

/** 归还引擎。失败的引擎须等全部使用者归还并关闭后才返回，避免旧资源与重跑并存。 */
async function release(engine: Engine): Promise<void> {
  const owner = shared;
  if (!owner || owner.engine !== engine) return engine.close();
  owner.users--;
  if (owner.users === 0) {
    try {
      await engine.close();
    } catch (error) {
      shutdown_failure = error;
      cpu_only = true;
      await forget_devices(undefined, error instanceof Error ? error.message : String(error));
    } finally {
      if (shared === owner) shared = undefined;
      owner.drain();
    }
  } else if (!engine.failed) return;
  await owner.drained;
  if (shutdown_failure) throw shutdown_failure;
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
          fail(
            header.stage === "decode"
              ? new DecodeFailure(String(header.error))
              : new Error(String(header.error)),
          );
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
    (value.asr === undefined || ["cpu", "webgpu"].includes(value.asr)) &&
    (value.det === undefined || ["cpu", "webgpu_single", "webgpu_dual"].includes(value.det)) &&
    Array.isArray(value.complete)
    ? value
    : undefined;
}

/** 原子发布缓存，读取方不会看到半写入的文件。 */
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

/** 配置与路径在父进程解析，执行核心和校准子进程不访问共享环境绑定。 */
function worker_config(profile: MediaProfile, probe?: "asr" | "det"): MediaWorkerConfig {
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
      asr: model(profile.asr === "cpu" || probe === "asr" ? "asr_cpu" : "asr_gpu", profile.asr),
      det: model(
        profile.det === "cpu" || probe === "det" ? "det_cpu" : "det_gpu",
        profile.det === "cpu" ? "cpu" : "webgpu",
      ),
    },
  };
}

/** 正式计算使用的配置：缓存失效或所选 GPU 权重缺失时使用 CPU 基线，不在计算中下载或校准。 */
async function inference_profile(): Promise<MediaProfile> {
  const cache = await inference_cache();
  if (!cache) return CPU_PROFILE;
  const { modelsDirectory: models } = media_configuration();
  return {
    asr: cache.asr === "webgpu" && model_ready(models, MEDIA_MODELS.asr_gpu) ? "webgpu" : "cpu",
    det:
      cache.det && cache.det !== "cpu" && model_ready(models, MEDIA_MODELS.det_gpu)
        ? cache.det
        : "cpu",
  };
}

/** 在独立校准子进程中测量一个候选。探测只在父进程改用 CPU 权重，子进程照常测量。 */
const measure = (profile: MediaProfile, task: "asr" | "det" | "mixed", probe = false) =>
  run_calibration(runtime_file("media-calibrate.mjs"), {
    profile,
    config: worker_config(profile, probe && task !== "mixed" ? task : undefined),
    worker: runtime_file("media-worker.mjs"),
    task,
  });

/** GPU 探测也必须等到独立进程关闭，不将它当成性能结论。 */
export async function probe_gpu(task: "asr" | "det"): Promise<void> {
  await measure(
    task === "asr" ? { asr: "webgpu", det: "cpu" } : { asr: "cpu", det: "webgpu_single" },
    task,
    true,
  );
}

/** 按任务复用测量；只有两种任务就绪且组合变化时才验证并发。调用方持有准备锁。 */
export async function calibrate_devices(
  tasks: readonly ("asr" | "det")[],
  gpu: ReadonlySet<"asr" | "det">,
  failures: Readonly<Record<string, string>>,
): Promise<void> {
  const previous = await inference_cache();
  const calibration: MediaCalibration = previous?.calibration ?? { asr: {}, det: {} };
  const reasons: Record<string, string> = { ...previous?.reasons };
  for (const task of tasks) {
    calibration[task] = {};
    for (const key of Object.keys(reasons)) if (key.startsWith(`${task}:`)) delete reasons[key];
    if (failures[task]) reasons[`${task}:preparation`] = failures[task]!;
    const candidates =
      task === "det"
        ? ["cpu", ...(gpu.has(task) ? ["webgpu_single", "webgpu_dual"] : [])]
        : ["cpu", ...(gpu.has(task) ? ["webgpu"] : [])];
    for (let launch = 0; launch < CALIBRATION_LAUNCHES; launch++) {
      for (const candidate of launch % 2 ? [...candidates].reverse() : candidates) {
        if (reasons[`${task}:${candidate}`]) continue;
        const profile: MediaProfile =
          task === "det"
            ? { asr: "cpu", det: candidate as MediaProfile["det"] }
            : { asr: candidate as MediaProfile["asr"], det: "cpu" };
        try {
          (calibration[task][candidate] ??= []).push(await measure(profile, task));
        } catch (error) {
          if (candidate === "cpu" || error instanceof CalibrationCleanupFailure) throw error;
          delete calibration[task][candidate];
          reasons[`${task}:${candidate}`] = error instanceof Error ? error.message : String(error);
        }
      }
    }
  }
  const ready = (["asr", "det"] as const).filter((task) => calibration[task].cpu);
  let profile = select_profile(calibration, ready);
  let mixed = previous?.mixed;
  if (ready.length === 2 && (!mixed || JSON.stringify(mixed.profile) !== JSON.stringify(profile))) {
    for (;;) {
      try {
        mixed = { profile, measurement: await measure(profile, "mixed") };
        break;
      } catch (error) {
        if (error instanceof CalibrationCleanupFailure) throw error;
        if (profile.asr === "cpu" && profile.det === "cpu") throw error;
        reasons[`mixed:${profile.asr}:${profile.det}`] =
          error instanceof Error ? error.message : String(error);
        profile = profile.asr !== "cpu" ? { ...profile, asr: "cpu" } : CPU_PROFILE;
      }
    }
  }
  write_cache({
    ...Object.fromEntries(ready.map((task) => [task, profile[task]])),
    key: cache_key(),
    expires: Date.now() + CACHE_TTL_MS,
    complete: ready.filter((task) => !reasons[`${task}:preparation`]),
    reasons,
    calibration,
    ...(mixed ? { mixed } : {}),
  });
  console.log(`媒体推理配置：${ready.map((task) => `${task} ${profile[task]}`).join("，")}`);
}

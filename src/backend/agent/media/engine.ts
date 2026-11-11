/**
 * 一次计算操作的资源所有权：根线程持有 Python helper 与推理 Worker，桥接两者的请求，
 * 等全部资源退出后才返回结果。设备由调用者指定，失败完成清理后交回调用者。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CLOSE_TIMEOUT_MS, Engine } from "./inference-engine";
import { default_native_fs as fs } from "../../../native/native-fs";
import { npm } from "../npm";
import { media_configuration } from "./runtime";
import { uv } from "../uv";
import { encode_frame, FrameReader, type ChannelHeader } from "./channel";
import { MEDIA_MODELS } from "./models";
import type { DeviceOptions, MediaDevice, MediaWorkerConfig } from "./worker-protocol";

export const ORT_PACKAGE = "onnxruntime-node";
/** 设备来自 AGENT 脚本，未知值必须在资源准备前拒绝。 */
export function validate_device(device: unknown): void {
  if (device !== "cpu" && device !== "gpu") throw new Error("Media device must be cpu or gpu.");
}

/** 模型路径只取宿主绑定的共享目录。 */
const model_file = (model: { file: string }): string =>
  path.join(media_configuration().modelsDirectory, model.file);
/** 私有运行资源随应用部署。 */
export const runtime_file = (name: string): string =>
  path.join(media_configuration().runtimeDirectory, "runtime", name);

/**
 * 共享 npm 工程中 ORT 的实际入口。根线程只解析路径，所有导入与会话都在 Worker 内，
 * 避免同步原生推理阻塞 helper 的消息桥接。
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
// 根线程持有 GPU 队尾，前一操作完成收尾后才能创建下一组会话。
let gpu_pending: Promise<unknown> = Promise.resolve();

/** 每次调用独占引擎。调用者在安全收尾后决定是否重跑。 */
export async function operate<T>(
  action: (engine: Engine) => Promise<T>,
  { device }: DeviceOptions,
): Promise<T> {
  validate_device(device);
  // 在真正执行时检查关闭失败，覆盖排队期间发生的故障。
  const run = async (): Promise<T> => {
    if (shutdown_failure) throw shutdown_failure;
    const engine = new Engine(
      worker_config(device === "gpu" ? "webgpu" : "cpu"),
      runtime_file("media-worker.mjs"),
    );
    try {
      return await action(engine);
    } finally {
      await close_engine(engine);
    }
  };
  if (device === "cpu") return run();
  const result = gpu_pending.then(run);
  gpu_pending = result.catch(() => undefined); // 调用者收到原错误，后续操作仍检查收尾是否成功。
  return result;
}

/** 退出失败使本次运行不可继续，保留故障供监管器收尾。 */
async function close_engine(engine: Engine): Promise<void> {
  try {
    await engine.close();
  } catch (error) {
    // 关闭错误不能仍以 DeviceFailure 暴露，否则调用者可能误判为可安全切换设备。
    shutdown_failure = new Error("Media engine could not close; the host must end this run.", {
      cause: error,
    });
    throw shutdown_failure;
  }
}

/**
 * 共享 uv 工程 `.venv` 中的解释器。不使用 PATH 中的 Python。
 * 环境由调用者经 `@lg/uv` 显式准备，计算不安装依赖，也不同步共享环境。
 */
export function python(): string {
  const executable = path.join(
    uv.directory,
    ".venv",
    ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]),
  );
  if (!fs.exists(executable))
    throw new Error(
      `Python environment is missing: ${executable}; run uv sync --inexact through @lg/uv first.`,
    );
  return executable;
}

/**
 * 运行 `media.py` 的一个命令。helper 的推理请求转发给 Worker，应答按编号写回。
 * 正常返回要求收到结果帧、helper 正常退出。任一请求失败时结束 helper 并抛出该失败。
 */
export async function helper(
  command: string,
  job: Readonly<Record<string, unknown>>,
  engine?: Engine,
): Promise<unknown> {
  // -I 忽略 PYTHON* 变量与用户 site，-X utf8 让日志在任何代码页下都是 UTF-8。
  const child = spawn(python(), ["-I", "-X", "utf8", runtime_file("media.py")], {
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

/** 配置与路径在父进程解析，执行核心不访问共享环境绑定。 */
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

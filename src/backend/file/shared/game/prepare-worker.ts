import { GAME_ENGINES, type GameSource } from "./engines";
import { Worker } from "node:worker_threads";
import type { GamePreparation } from "./prepare";
import { default_native_fs, type NativeFs } from "../../../../native/native-fs";
import type { LogError } from "../../../../shared/error";

export type GamePrepareTask = GameSource & Readonly<{ staging: string }>;
export type GamePrepareResponse = { result: GamePreparation } | { error: LogError };
export type GamePrepareExecution = (
  task: GamePrepareTask,
  signal?: AbortSignal,
) => Promise<GamePreparation>;

/** 显式同进程入口使用调用方的文件系统，线程入口使用正式文件系统。 */
export function stage_game_source(
  task: GamePrepareTask,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GamePreparation> {
  return GAME_ENGINES[task.file_type].stage(task, fs, signal);
}

/** 按次启动线程，取消时协作关闭文件句柄，退出后才交还暂存目录。 */
export class GamePrepareWorker {
  private readonly lifetime = new AbortController(); // 实例关闭也取消本次及后续准备。
  private readonly active = new Set<Promise<GamePreparation>>(); // 关闭等待调用方完成线程收尾。

  /** 宿主提供构建入口，`null` 仅用于显式同进程执行。 */
  public constructor(
    private readonly entry: URL | null,
    private readonly fs: NativeFs = default_native_fs,
  ) {}

  /** 固定任务快照，并把调用取消与实例关闭合成一个生命周期。 */
  public readonly run: GamePrepareExecution = async (task, signal) => {
    const combined = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    combined.throwIfAborted();
    const pending = this.execute(structuredClone(task), combined);
    this.active.add(pending);
    try {
      return await pending;
    } finally {
      this.active.delete(pending);
    }
  };

  /** 通知活动任务停止，等待线程退出后再结束关闭。 */
  public async dispose(): Promise<void> {
    this.lifetime.abort();
    await Promise.allSettled(this.active);
  }

  /** 回包只记录结果，线程退出才允许提交层接管暂存目录。 */
  private async execute(task: GamePrepareTask, signal: AbortSignal): Promise<GamePreparation> {
    if (!this.entry) {
      return stage_game_source(task, this.fs, signal);
    }
    const worker = new Worker(this.entry, { workerData: task });
    let response: GamePrepareResponse | undefined;
    const abort = () => worker.postMessage("abort"); // 取消仅发消息，等待线程释放句柄。
    signal.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        worker.on("message", (message: GamePrepareResponse) => {
          response = message;
        });
        worker.once("error", reject);
        worker.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error("Game worker exited: " + code)),
        );
        if (signal.aborted) abort();
      });
      signal.throwIfAborted();
      if (!response) throw new Error("Game worker returned no result");
      if ("error" in response) throw new Error(response.error.message, { cause: response.error });
      return response.result;
    } finally {
      signal.removeEventListener("abort", abort);
      await worker.terminate(); // 启动或消息失败也须等到线程释放后返回。
    }
  }
}

import { Worker } from "node:worker_threads";
import { stage_rpgmaker_source } from "./prepare";
import type { RPGMakerSource } from "./source";
import type { GamePreparation } from "../shared/rpgmaker-prepare";
import { default_native_fs } from "../../../native/native-fs";
import type { LogError } from "../../../shared/error";

export type RPGMakerMvMzPrepareTask = Readonly<{ game: RPGMakerSource; staging: string }>;
export type RPGMakerMvMzPrepareResponse = { result: GamePreparation } | { error: LogError };
export type RPGMakerMvMzPrepareExecution = (
  task: RPGMakerMvMzPrepareTask,
  signal?: AbortSignal,
) => Promise<GamePreparation>;

/** 按次启动线程；取消协作关闭文件句柄，退出后才交还暂存目录。 */
export class RPGMakerMvMzPrepareWorker {
  private readonly lifetime = new AbortController();
  private readonly active = new Set<Promise<GamePreparation>>(); // 关闭等待调用方完成线程收尾。

  /** 宿主提供构建入口，`null` 仅用于显式同进程执行。 */
  public constructor(private readonly entry: URL | null) {}

  /** 固定任务快照，并把调用取消与实例关闭合成一个生命周期。 */
  public readonly run: RPGMakerMvMzPrepareExecution = async (task, signal) => {
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
  private async execute(
    task: RPGMakerMvMzPrepareTask,
    signal: AbortSignal,
  ): Promise<GamePreparation> {
    if (!this.entry) {
      return stage_rpgmaker_source(task, default_native_fs, signal);
    }
    const worker = new Worker(this.entry, { workerData: task });
    let response: RPGMakerMvMzPrepareResponse | undefined;
    const abort = () => worker.postMessage("abort");
    signal.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        worker.on("message", (message: RPGMakerMvMzPrepareResponse) => {
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

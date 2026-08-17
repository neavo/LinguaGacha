import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";

import type { AgentRelatedItemSearchResult } from "../../shared/backend-runtime";
import type { RelatedItemSearchWorkerInput } from "./desktop-agent-related-item-search-worker";

/** main 与相关搜索 worker 共用的请求和取消消息。 */
export type RelatedItemSearchWorkerIncomingMessage =
  | Readonly<{ id: string; type: "search"; input: RelatedItemSearchWorkerInput }>
  | Readonly<{ id: string; type: "cancel" }>;

/** worker 只回传可克隆结果或保留原始上下文的错误消息。 */
export type RelatedItemSearchWorkerOutgoingMessage =
  | Readonly<{ id: string; ok: true; result: AgentRelatedItemSearchResult }>
  | Readonly<{ id: string; ok: false; message: string }>;

/** 单个请求的结算函数与 AbortSignal 监听必须一起释放。 */
type PendingSearch = {
  signal: AbortSignal;
  resolve: (result: AgentRelatedItemSearchResult) => void;
  reject: (error: unknown) => void;
  abort: () => void;
};

/** Electron main 的相关搜索门面；SQLite 和索引构建始终留在独立 worker。 */
export class DesktopAgentRelatedItemSearch {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingSearch>();
  private disposed = false;

  public constructor(private readonly worker_entry_url: URL) {}

  /** 首次请求才创建 worker；每个请求以 id 隔离响应与取消。 */
  public search(
    input: RelatedItemSearchWorkerInput,
    signal: AbortSignal,
  ): Promise<AgentRelatedItemSearchResult> {
    if (this.disposed) return Promise.reject(new Error("Related item search is disposed."));
    if (signal.aborted) return Promise.reject(signal.reason);
    const worker = this.worker ?? this.create_worker();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const pending: PendingSearch = {
        signal,
        resolve,
        reject,
        abort: () => {
          worker.postMessage({
            id,
            type: "cancel",
          } satisfies RelatedItemSearchWorkerIncomingMessage);
          this.finish(id, null, signal.reason ?? new Error("Related item search was cancelled."));
        },
      };
      signal.addEventListener("abort", pending.abort, { once: true });
      this.pending.set(id, pending);
      worker.postMessage({
        id,
        type: "search",
        input,
      } satisfies RelatedItemSearchWorkerIncomingMessage);
    });
  }

  /** 应用退出时拒绝全部未完成请求并终止唯一 worker。 */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.pending.keys()) {
      this.finish(id, null, new Error("Related item search is disposed."));
    }
    void this.worker?.terminate();
    this.worker = null;
  }

  /** 创建并绑定可复用 worker；异常退出由 fail_worker 统一结算。 */
  private create_worker(): Worker {
    const worker = new Worker(this.worker_entry_url);
    this.worker = worker;
    worker.on("message", (message: RelatedItemSearchWorkerOutgoingMessage) => {
      if (message.ok) this.finish(message.id, message.result, null);
      else this.finish(message.id, null, new Error(message.message));
    });
    worker.on("error", (error) => this.fail_worker(worker, error));
    worker.on("exit", (code) => {
      if (!this.disposed && this.worker === worker) {
        this.fail_worker(
          worker,
          new Error(`Related item search worker exited: ${code.toString()}`),
        );
      }
    });
    return worker;
  }

  /** 结算单个请求并同步移除 AbortSignal 监听，迟到消息直接忽略。 */
  private finish(id: string, result: AgentRelatedItemSearchResult | null, error: unknown): void {
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.pending.delete(id);
    pending.signal.removeEventListener("abort", pending.abort);
    if (error === null && result !== null) pending.resolve(result);
    else pending.reject(error);
  }

  /** 当前 worker 失效时拒绝其全部请求，下一次搜索再懒创建实例。 */
  private fail_worker(worker: Worker, error: unknown): void {
    if (this.worker !== worker) return;
    this.worker = null;
    for (const id of this.pending.keys()) this.finish(id, null, error);
  }
}

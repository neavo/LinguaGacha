import type { WorkspaceRequest, WorkspaceRequestResult } from "./host-contract";
import type {
  AgentWorkspaceRuntimeChildMessage,
  AgentWorkspaceRuntimeParentMessage,
} from "./protocol";

type PendingRequest = {
  resolve: (value: WorkspaceRequestResult) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal | undefined;
  abortListener?: () => void;
};

/** 工作区请求共用关联、取消和 IPC 保活，代理与宿主操作拥有同一生命周期。 */
export class AgentWorkspaceRequestChannel {
  private readonly pending = new Map<number, PendingRequest>(); // 只持有当前脚本尚未结算的请求
  private next_id = 1; // 单进程内递增，取消后的迟到回包不会匹配后续请求

  /** 通道只负责并发请求的关联与取消，操作由父进程分发。 */
  public constructor(
    private readonly send: (message: AgentWorkspaceRuntimeChildMessage) => Promise<void>,
    private readonly set_pending: (pending: boolean) => void,
  ) {}

  /** 建立可取消请求，并等待父进程完成操作。 */
  public async call(
    operation: WorkspaceRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceRequestResult> {
    signal?.throwIfAborted();
    const id = this.next_id++;
    const result = new Promise<WorkspaceRequestResult>((resolve, reject) => {
      const request: PendingRequest = { resolve, reject, signal };
      if (signal !== undefined) {
        request.abortListener = () => {
          if (!this.pending.delete(id)) return;
          this.set_pending(this.pending.size > 0);
          void this.send({ type: "cancel", id }).catch(() => {
            // 原请求已取消；关闭中的 IPC 无法投递取消消息时，进程退出负责回收。
          });
          reject(signal.reason);
        };
        signal.addEventListener("abort", request.abortListener, { once: true });
      }
      this.pending.set(id, request);
      this.set_pending(true);
    });
    void this.send({ type: "request", id, request: operation }).catch((error: unknown) => {
      this.accept({
        type: "response",
        id,
        result: { ok: false, message: error instanceof Error ? error.message : String(error) },
      });
    });
    return await result;
  }

  /** 只结算仍在等待的同 ID 请求；迟到结果不再改写状态。 */
  public accept(message: Extract<AgentWorkspaceRuntimeParentMessage, { type: "response" }>): void {
    const request = this.pending.get(message.id);
    if (request === undefined) return;
    this.pending.delete(message.id);
    this.set_pending(this.pending.size > 0);
    if (request.signal !== undefined && request.abortListener !== undefined) {
      request.signal.removeEventListener("abort", request.abortListener);
    }
    if (message.result.ok) request.resolve(message.result.value);
    else request.reject(new Error(message.result.message));
  }
}

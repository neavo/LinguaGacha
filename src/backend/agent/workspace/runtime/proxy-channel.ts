import type { SystemProxyResolver } from "../../../network/system-proxy-http-client";
import type {
  AgentWorkspaceRuntimeChildMessage,
  AgentWorkspaceRuntimeParentMessage,
} from "./protocol";

type ProxyRequest = {
  resolve: (rules: string) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
};

/** 工作区进程内的 SystemProxyResolver；仅通过 IPC 查询 Electron 当前代理规则。 */
export class AgentWorkspaceProxyChannel implements SystemProxyResolver {
  private readonly pending = new Map<number, ProxyRequest>(); // 只持有当前脚本尚未结算的代理请求
  private next_id = 1; // 单进程内递增，取消后的迟到回包不会匹配后续请求

  /** 通道只负责并发请求的关联与取消，规则解析由共用 HTTP 客户端拥有。 */
  public constructor(
    private readonly send: (message: AgentWorkspaceRuntimeChildMessage) => Promise<void>,
    private readonly set_pending: (pending: boolean) => void,
  ) {}

  /** 为单次 fetch 建立可取消请求，并等待父进程返回对应路线。 */
  public async resolveProxy(url: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const id = this.next_id++;
    const result = new Promise<string>((resolve, reject) => {
      const request: ProxyRequest = { resolve, reject, signal };
      if (signal !== undefined) {
        request.abortListener = () => {
          if (!this.pending.delete(id)) return;
          this.set_pending(this.pending.size > 0);
          void this.send({ type: "proxy_cancel", id }).catch(() => {
            // 原请求已取消；关闭中的 IPC 无法投递取消消息时，进程退出负责回收。
          });
          reject(signal.reason);
        };
        signal.addEventListener("abort", request.abortListener, { once: true });
      }
      this.pending.set(id, request);
      this.set_pending(true);
    });
    void this.send({ type: "proxy_request", id, url }).catch((error: unknown) => {
      this.accept({
        type: "proxy_result",
        id,
        result: { ok: false, message: error instanceof Error ? error.message : String(error) },
      });
    });
    return await result;
  }

  /** 只结算仍在等待的同 ID 请求；迟到结果不再改写状态。 */
  public accept(
    message: Extract<AgentWorkspaceRuntimeParentMessage, { type: "proxy_result" }>,
  ): void {
    const request = this.pending.get(message.id);
    if (request === undefined) return;
    this.pending.delete(message.id);
    this.set_pending(this.pending.size > 0);
    if (request.signal !== undefined && request.abortListener !== undefined) {
      request.signal.removeEventListener("abort", request.abortListener);
    }
    if (message.result.ok) request.resolve(message.result.rules);
    else request.reject(new Error(message.result.message));
  }
}

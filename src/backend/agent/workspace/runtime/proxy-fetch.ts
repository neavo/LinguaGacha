import type { SystemProxyRoute } from "../../../network/system-proxy-http-client";
import type {
  AgentWorkspaceRuntimeChildMessage,
  AgentWorkspaceRuntimeParentMessage,
} from "./protocol";

type DenoHttpClient = { close(): void };
type DenoGlobal = {
  createHttpClient(options: {
    proxy: { transport: "http" | "https" | "socks5"; url: string };
  }): DenoHttpClient;
};
type DenoFetchInit = RequestInit & { client?: DenoHttpClient };

type ProxyRequest = {
  resolve: (route: SystemProxyRoute) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
};

/** Deno 进程内代理请求通道；只为透明 fetch 提供当前 URL 的系统路线。 */
export class AgentWorkspaceProxyChannel {
  private readonly pending = new Map<number, ProxyRequest>();
  private next_id = 1;
  private closed = false;

  /** 写端由 Deno entry 串行化，通道只负责请求身份与生命周期。 */
  public constructor(
    private readonly send: (message: AgentWorkspaceRuntimeChildMessage) => Promise<void>,
  ) {}

  /** 为单次 fetch 建立可取消请求，并等待父进程返回对应路线。 */
  public async resolve(url: string, signal?: AbortSignal): Promise<SystemProxyRoute> {
    signal?.throwIfAborted();
    if (this.closed) throw new Error("Workspace runtime proxy channel is closed.");
    const id = this.next_id++;
    const result = new Promise<SystemProxyRoute>((resolve, reject) => {
      const request: ProxyRequest = { resolve, reject, signal };
      if (signal !== undefined) {
        request.abortListener = () => {
          if (!this.pending.delete(id)) return;
          void this.send({ type: "proxy_cancel", id });
          reject(signal.reason);
        };
        signal.addEventListener("abort", request.abortListener, { once: true });
      }
      this.pending.set(id, request);
    });
    try {
      await this.send({ type: "proxy_request", id, url });
    } catch (error) {
      const request = this.pending.get(id);
      this.pending.delete(id);
      if (request?.signal !== undefined && request.abortListener !== undefined) {
        request.signal.removeEventListener("abort", request.abortListener);
      }
      throw error;
    }
    return await result;
  }

  /** 只结算仍在等待的同 ID 请求；迟到结果不再改写状态。 */
  public accept(message: AgentWorkspaceRuntimeParentMessage): void {
    if (message.type !== "proxy_result") {
      throw new Error("Workspace runtime received an unexpected parent message.");
    }
    const request = this.pending.get(message.id);
    if (request === undefined) return;
    this.pending.delete(message.id);
    if (request.signal !== undefined && request.abortListener !== undefined) {
      request.signal.removeEventListener("abort", request.abortListener);
    }
    if (message.result.ok) request.resolve(message.result.route);
    else request.reject(new Error(message.result.message));
  }

  /** 关闭时拒绝全部待决请求，并移除它们的调用方监听器。 */
  public close(reason: unknown): void {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      if (request.signal !== undefined && request.abortListener !== undefined) {
        request.signal.removeEventListener("abort", request.abortListener);
      }
      request.reject(reason);
    }
    this.pending.clear();
  }
}

/** 安装按 URL 查询 Electron 系统路线的全局 fetch，并在结束时恢复原入口和关闭连接池。 */
export function install_agent_workspace_proxy_fetch(
  channel: AgentWorkspaceProxyChannel,
): () => void {
  const deno = (globalThis as typeof globalThis & { Deno: DenoGlobal }).Deno;
  const native_fetch = globalThis.fetch;
  const clients = new Map<string, DenoHttpClient>();
  const proxy_fetch: typeof globalThis.fetch = async (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const route = await channel.resolve(read_request_url(input), signal);
    signal?.throwIfAborted();
    const client = resolve_client(deno, clients, route);
    return await native_fetch(input, {
      ...init,
      ...(client === undefined ? {} : { client }),
    } as DenoFetchInit);
  };
  globalThis.fetch = proxy_fetch;
  return () => {
    if (globalThis.fetch === proxy_fetch) globalThis.fetch = native_fetch;
    for (const client of clients.values()) client.close();
    clients.clear();
  };
}

/** 统一 fetch 三种输入形状，代理解析始终获得绝对 URL。 */
function read_request_url(input: Parameters<typeof globalThis.fetch>[0]): string {
  return typeof input === "string" || input instanceof URL ? new URL(input).href : input.url;
}

/** DIRECT 不创建连接池；相同代理 URI 在当前脚本内共享 Deno HttpClient。 */
function resolve_client(
  deno: DenoGlobal,
  clients: Map<string, DenoHttpClient>,
  route: SystemProxyRoute,
): DenoHttpClient | undefined {
  if (route.kind === "direct") return undefined;
  const existing = clients.get(route.uri);
  if (existing !== undefined) return existing;
  const protocol = new URL(route.uri).protocol;
  const transport = route.kind === "socks5" ? "socks5" : protocol === "https:" ? "https" : "http";
  const client = deno.createHttpClient({ proxy: { transport, url: route.uri } });
  clients.set(route.uri, client);
  return client;
}

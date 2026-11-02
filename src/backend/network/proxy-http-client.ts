import {
  fetch as undici_fetch,
  Request as UndiciRequest,
  Response as UndiciResponse,
  Headers as UndiciHeaders,
  FormData as UndiciFormData,
} from "undici";
import { record_http_response_info } from "./http-response-info";
import { ProxyDispatcher } from "./proxy-dispatcher";
import type { ProxyResolver } from "./proxy-route";

type FetchGlobals = Pick<
  typeof globalThis,
  "fetch" | "Request" | "Response" | "Headers" | "FormData"
>;

// fetch 与其对象构造器必须来自同一 Undici 版本，避免 Node 内置版本的品牌和 dispatcher 协议差异。
const FETCH_CONSTRUCTORS = {
  Request: UndiciRequest,
  Response: UndiciResponse,
  Headers: UndiciHeaders,
  FormData: UndiciFormData,
} as unknown as Omit<FetchGlobals, "fetch">;

/** 当前线程唯一的普通 HTTP 入口，路由与传输资源统一归自有调度器管理。 */
export class ProxyHttpClient {
  private readonly dispatcher: ProxyDispatcher;
  private readonly redirects: "error" | "request";
  private previous_globals: FetchGlobals | null = null;
  private disposal: Promise<void> | null = null;

  /** 创建独占调度器，入口只额外决定是否允许重定向。 */
  public constructor(
    resolver: ProxyResolver,
    options: { redirects: "error" | "request" } = { redirects: "error" },
  ) {
    this.redirects = options.redirects;
    this.dispatcher = new ProxyDispatcher(resolver);
  }

  /** 重定向和取消遵循 Undici 请求语义，后端入口额外禁止自动重定向。 */
  public readonly fetch: typeof globalThis.fetch = async (input, init) => {
    if (this.disposal !== null) throw new Error("Proxy HTTP client is disposed.");
    const response = (await undici_fetch(input as Parameters<typeof undici_fetch>[0], {
      ...(init as Parameters<typeof undici_fetch>[1]),
      dispatcher: this.dispatcher,
      ...(this.redirects === "error" ? { redirect: "error" as const } : {}),
    })) as unknown as Response;
    record_http_response_info(response);
    return response;
  };

  /** Backend 线程只有一个普通 HTTP transport，第三方 SDK 也从同一全局入口取用。 */
  public install_as_global_fetch(): void {
    if (this.disposal !== null || this.previous_globals !== null) {
      throw new Error("Proxy HTTP client cannot be installed in its current state.");
    }
    const { fetch, Request, Response, Headers, FormData } = globalThis;
    this.previous_globals = { fetch, Request, Response, Headers, FormData };
    Object.assign(globalThis, FETCH_CONSTRUCTORS);
    globalThis.fetch = this.fetch;
  }

  /** 同步恢复全局对象并停止派发，重复释放等待同一次调度器收尾。 */
  public dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal;
    if (this.previous_globals !== null) {
      Object.assign(globalThis, this.previous_globals);
      this.previous_globals = null;
    }
    this.disposal = this.dispatcher.close();
    return this.disposal;
  }
}

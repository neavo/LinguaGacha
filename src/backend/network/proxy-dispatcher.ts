import { Agent, Dispatcher, ProxyAgent, Socks5ProxyAgent, errors } from "undici";
import { resolve_proxy_route, type ProxyResolver, type ProxyRoute } from "./proxy-route";

type CloseCallback = (error?: Error | null) => void;

/** 每次实际派发重新选路，独占解析等待与全部 Undici 连接池。 */
export class ProxyDispatcher extends Dispatcher {
  private readonly direct = new Agent();
  private readonly proxies = new Map<string, Dispatcher>();
  private readonly pending = new Set<(error: Error) => void>(); // 关闭只取消解析等待，已交接请求由连接池排空。
  private readonly active = new Set<(error: Error) => void>(); // `Agent.close()` 会移除内部池索引，升级销毁须保留在途控制器。
  private accepting = true;
  private closing: Promise<void> | null = null; // 重复关闭共享完成结果，销毁时也等待它回收已移交的内部池。
  private destroying: Promise<void> | null = null;

  /** 每个客户端独占连接池，查询时读取宿主当前规则。 */
  public constructor(private readonly resolver: ProxyResolver) {
    super();
  }

  /** 同步接收派发，异步解析期间通过稳定控制器接受取消。 */
  public override dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    const waiting = new AbortController();
    let transport: Dispatcher.DispatchController | null = null;
    let settled = false;
    let paused = false; // 底层控制器建立前暂存背压状态。
    // 取消和迟到解析共用结算入口，避免重复报告失败。
    const finish_error = (error: Error): void => {
      if (settled) return;
      settled = true;
      this.pending.delete(cancel);
      this.active.delete(cancel);
      handler.onResponseError?.(controller, error);
    };
    const cancel = (error: Error): void => controller.abort(error);
    // 上游只接收一次开始。稳定控制器先取消解析，交接后转发取消和背压，并读取底层原始响应头。
    const controller: Dispatcher.DispatchController = {
      get aborted() {
        return waiting.signal.aborted || (transport?.aborted ?? false); // 合并两个阶段的取消状态。
      },
      get reason(): Error | null {
        // 优先保留调用方的取消原因。
        return waiting.signal.aborted
          ? (waiting.signal.reason as Error)
          : (transport?.reason ?? null);
      },
      get paused() {
        return transport?.paused ?? paused; // 交接后读取实际背压状态。
      },
      get rawHeaders() {
        return transport?.rawHeaders ?? null; // Undici fetch 消费原始响应头。
      },
      get rawTrailers() {
        return transport?.rawTrailers ?? null; // 尾部字段沿同一控制器交付。
      },
      abort(error) {
        // 解析阶段立即结算，传输阶段等待底层回报错误。
        if (settled || waiting.signal.aborted) return;
        waiting.abort(error);
        if (transport !== null) transport.abort(error);
        else finish_error(error);
      },
      pause() {
        // 交接前后的暂停使用同一入口。
        paused = true;
        transport?.pause();
      },
      resume() {
        // 恢复同时清除尚未交接的暂停状态。
        paused = false;
        transport?.resume();
      },
    };

    if (!this.accepting) {
      queueMicrotask(() => finish_error(new errors.ClientClosedError()));
      return false;
    }
    this.pending.add(cancel);
    try {
      handler.onRequestStart?.(controller, {});
      if (settled) return true;
      // `path` 可以以 `//` 开头，拼接 `origin` 可防止相对 URL 解析把路径误作目标主机。
      const url = new URL(options.origin!).origin + options.path;
      void resolve_proxy_route(this.resolver, url, waiting.signal)
        .then((route) => {
          if (settled) return; // 关闭已取消全部解析等待，迟到结果不能重建连接池。
          const pool = this.resolve_pool(route);
          this.pending.delete(cancel);
          this.active.add(cancel);
          pool.dispatch(options, {
            onRequestStart: (next) => {
              transport = next;
              if (waiting.signal.aborted) next.abort(waiting.signal.reason);
              else if (paused) next.pause();
            },
            onRequestUpgrade: (_controller, ...args) => {
              if (settled) return;
              settled = true;
              this.active.delete(cancel);
              handler.onRequestUpgrade?.(controller, ...args);
            },
            onResponseStart: (_controller, ...args) =>
              handler.onResponseStart?.(controller, ...args),
            onResponseData: (_controller, chunk) => handler.onResponseData?.(controller, chunk),
            onResponseEnd: (_controller, trailers) => {
              if (settled) return;
              handler.onResponseEnd?.(controller, trailers);
              settled = true;
              this.active.delete(cancel);
            },
            onResponseError: (_controller, error) => finish_error(error),
            onResponseStarted: () => handler.onResponseStarted?.(),
            onBodySent: (chunk) => handler.onBodySent?.(chunk),
            onRequestSent: () => handler.onRequestSent?.(),
          });
        })
        .catch(finish_error);
    } catch (error) {
      finish_error(error as Error);
    }
    return true;
  }

  /** 停止解析并等待已交接的请求排空，重复调用共享收尾结果。 */
  public override close(): Promise<void>;
  public override close(callback: CloseCallback): void;
  public override close(callback?: CloseCallback): Promise<void> | void {
    this.stop(new errors.ClientClosedError());
    this.closing ??= this.destroying ?? this.finish_pools("close");
    return this.complete(this.closing, callback);
  }

  /** 中断在途传输，并接管已经开始的有序关闭。 */
  public override destroy(): Promise<void>;
  public override destroy(error: Error | null): Promise<void>;
  public override destroy(callback: CloseCallback): void;
  public override destroy(error: Error | null, callback: CloseCallback): void;
  public override destroy(
    error_or_callback?: Error | null | CloseCallback,
    callback?: CloseCallback,
  ): Promise<void> | void {
    const error = typeof error_or_callback === "function" ? null : error_or_callback;
    const reason = error ?? new errors.ClientDestroyedError();
    this.stop(reason);
    for (const cancel of this.active) cancel(reason);
    this.destroying ??= this.finish_pools("destroy", error);
    return this.complete(
      this.destroying,
      typeof error_or_callback === "function" ? error_or_callback : callback,
    );
  }

  /** 同步停止接收请求，并结算仍由解析阶段拥有的操作。 */
  private stop(error: Error): void {
    this.accepting = false;
    for (const cancel of this.pending) cancel(error);
  }

  /** 按路由复用连接池，每次派发仍重新查询路由。 */
  private resolve_pool(route: ProxyRoute): Dispatcher {
    if (route.kind === "direct") return this.direct;
    const key = `${route.kind}:${route.uri}`;
    let pool = this.proxies.get(key);
    if (pool === undefined) {
      pool = route.kind === "socks5" ? new Socks5ProxyAgent(route.uri) : new ProxyAgent(route.uri);
      this.proxies.set(key, pool);
    }
    return pool;
  }

  /** 各连接池独立收尾，单项失败不能跳过其余资源。 */
  private async finish_pools(operation: "close" | "destroy", error?: Error | null): Promise<void> {
    const results = await Promise.allSettled([
      ...[this.direct, ...this.proxies.values()].map((pool) =>
        Promise.resolve().then(() =>
          operation === "close" ? pool.close() : pool.destroy(error ?? null),
        ),
      ),
      // `close()` 已接管的内部池也须完成回收，`destroy()` 的完成条件覆盖升级前后的全部资源。
      ...(operation === "destroy" && this.closing !== null ? [this.closing] : []),
    ]);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0)
      throw new AggregateError(failures, `Proxy dispatcher failed to ${operation}.`);
  }

  /** Promise 与 Undici 回调形式消费同一次收尾结果。 */
  private complete(result: Promise<void>, callback?: CloseCallback): Promise<void> | void {
    if (callback === undefined) return result;
    void result.then(
      () => callback(null),
      (error: Error) => callback(error),
    );
  }
}

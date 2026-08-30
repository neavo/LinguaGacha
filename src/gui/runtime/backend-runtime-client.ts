import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";

import type { AppLanguage } from "../../domain/app-language";
import {
  normalize_log_error,
  sanitize_log_error_context,
  to_log_error,
  type LogErrorContextInput,
} from "../../shared/error";
import type { LocaleKey } from "../../shared/i18n";
import type {
  BackendRuntimeDiagnosticLevel,
  BackendRuntimeAgentWorkspaceRunRequest,
  BackendRuntimeAgentWorkspaceRunResponse,
  BackendRuntimeHostOperation,
  BackendRuntimeMainMessage,
  BackendRuntimeReady,
  BackendRuntimeResult,
  BackendRuntimeWorkerMessage,
} from "../../shared/backend-runtime";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/** Electron main 对 Backend Runtime worker 的单生命周期控制端；退出后不重启或回退同进程。 */
export class BackendRuntimeClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingRequest>(); // requestId 隔离并发控制响应
  private readonly active_host_operations = new Map<string, AbortController>(); // worker 可按 requestId 取消 main 副作用
  private start_promise: Promise<BackendRuntimeReady> | null = null; // 固化单次启动结果，禁止复用实例重启
  private start_reject: ((error: Error) => void) | null = null; // worker 提前退出时结算尚未 ready 的 start
  private ready = false; // 只有 ready 后退出才属于应用运行期故障
  private stopped = false; // 主动 stop 只抑制 unexpected-exit 回调，不跳过 pending 拒绝
  private exit_handled = false; // error 与 exit 可能连续到达，只允许结算一次

  /** 构造时固定单个 worker 生命周期所需的 Electron main 宿主端口。 */
  public constructor(
    private readonly options: {
      workerEntryUrl: URL;
      appRoot: string;
      resolveProxy: (url: string) => Promise<string>;
      openOutputFolder: (path: string) => Promise<void>;
      /** main 在一次性 Chromium 沙箱中执行工作区脚本。 */
      runAgentWorkspace: (
        request: BackendRuntimeAgentWorkspaceRunRequest,
        signal: AbortSignal,
      ) => Promise<BackendRuntimeAgentWorkspaceRunResponse>;
      onUnexpectedExit: (error: Error) => void;
    },
  ) {}

  /** 创建 worker 并等待 ready；启动失败直接拒绝，不提供同进程降级路径。 */
  public start(): Promise<BackendRuntimeReady> {
    if (this.start_promise !== null) return this.start_promise;
    this.ready = false;
    this.stopped = false;
    this.exit_handled = false;
    const worker = new Worker(this.options.workerEntryUrl, {
      workerData: { appRoot: this.options.appRoot },
    });
    this.worker = worker;
    this.start_promise = new Promise<BackendRuntimeReady>((resolve, reject) => {
      this.start_reject = reject;
      const on_start_message = (message: BackendRuntimeWorkerMessage): void => {
        if (message.type === "ready") {
          worker.off("message", on_start_message);
          this.ready = true;
          this.start_reject = null;
          resolve(message.data);
        } else if (message.type === "start_failed") {
          worker.off("message", on_start_message);
          this.stopped = true;
          this.start_reject = null;
          reject(to_error(message.error));
        }
      };
      worker.on("message", on_start_message);
    });
    worker.on("message", (message: BackendRuntimeWorkerMessage) => this.handle_message(message));
    worker.on("error", (error) => this.handle_exit(error));
    worker.on("exit", (code) => {
      // 主动 stop 期间也必须拒绝尚未收到 response 的请求，否则退出流程会永久等待。
      this.handle_exit(new Error(`Backend runtime worker exited: ${code.toString()}.`));
    });
    return this.start_promise;
  }

  /** 是否已没有可接受控制请求的 worker。 */
  public isStopped(): boolean {
    return this.stopped || this.worker === null;
  }

  /** 请求 worker 完整释放 Backend 资源，随后终止线程句柄。 */
  public async stop(): Promise<void> {
    const worker = this.worker;
    if (worker === null || this.stopped) return;
    this.stopped = true;
    try {
      await this.request({ type: "stop", requestId: randomUUID() });
    } finally {
      this.worker = null;
      await worker.terminate();
    }
  }

  /** 从 Backend 所有的设置服务读取当前应用语言。 */
  public async readAppLanguage(): Promise<AppLanguage> {
    return (await this.request({
      type: "read_app_language",
      requestId: randomUUID(),
    })) as AppLanguage;
  }

  /** 将宿主异常压缩为可克隆诊断载荷，再交给 worker 内的 LogManager。 */
  public async recordHostDiagnostic(args: {
    level: BackendRuntimeDiagnosticLevel;
    messageKey: LocaleKey;
    error?: unknown;
    context?: LogErrorContextInput;
  }): Promise<void> {
    await this.request({
      type: "record_host_diagnostic",
      requestId: randomUUID(),
      level: args.level,
      messageKey: args.messageKey,
      ...(args.error === undefined ? {} : { error: to_log_error(args.error) }),
      ...(args.context === undefined ? {} : { context: sanitize_log_error_context(args.context) }),
    });
  }

  /** 注册 requestId 后再发消息，确保同步到达的响应也能找到结算目标。 */
  private async request(message: BackendRuntimeMainMessage): Promise<unknown> {
    const worker = this.worker;
    if (worker === null) throw new Error("Backend runtime worker has not started.");
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(message.requestId, { resolve, reject });
    });
    worker.postMessage(message);
    return await result;
  }

  /** 分流宿主回调和普通控制响应；生命周期消息只由 start 监听器消费。 */
  private handle_message(message: BackendRuntimeWorkerMessage): void {
    if (message.type === "host_cancel") {
      this.active_host_operations.get(message.requestId)?.abort();
      return;
    }
    if (message.type === "host_request") {
      void this.handle_host_request(message.requestId, message.operation);
      return;
    }
    if (message.type !== "response") return;
    const pending = this.pending.get(message.requestId);
    if (pending === undefined) return;
    this.pending.delete(message.requestId);
    if (message.result.ok) pending.resolve(message.result.data);
    else pending.reject(to_error(message.result.error));
  }

  /** 在 Electron main 执行 worker 无权访问的宿主操作，并把错误结构化回传。 */
  private async handle_host_request(
    request_id: string,
    operation: BackendRuntimeHostOperation,
  ): Promise<void> {
    const controller = new AbortController();
    this.active_host_operations.set(request_id, controller);
    let result: BackendRuntimeResult;
    try {
      let data: unknown;
      switch (operation.kind) {
        case "resolve_proxy":
          data = await this.options.resolveProxy(operation.url);
          break;
        case "open_output_folder":
          data = await this.options.openOutputFolder(operation.path);
          break;
        case "run_agent_workspace":
          data = await this.options.runAgentWorkspace(operation.request, controller.signal);
          break;
      }
      result = { ok: true, data };
    } catch (error) {
      result = { ok: false, error: to_log_error(error) };
    } finally {
      this.active_host_operations.delete(request_id);
    }
    this.worker?.postMessage({ type: "host_response", requestId: request_id, result });
  }

  /** 统一结算启动与控制请求；只有 ready 后的非主动退出才升级为应用级故障。 */
  private handle_exit(error: Error): void {
    // error 可能早于 exit 到达，必须先关闭请求入口，避免两事件之间产生永不结算的新请求。
    this.worker = null;
    if (this.exit_handled) return;
    this.exit_handled = true;
    this.start_reject?.(error);
    this.start_reject = null;
    for (const controller of this.active_host_operations.values()) controller.abort();
    this.active_host_operations.clear();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    if (!this.stopped && this.ready) this.options.onUnexpectedExit(error);
  }
}

/** 把 worker 返回的结构化错误恢复为保留名称和调用栈的本地 Error。 */
function to_error(value: unknown): Error {
  const error = normalize_log_error(value, "Backend runtime 调用失败。");
  const result = new Error(error.message);
  result.name = error.name ?? "BackendRuntimeError";
  result.stack = error.stack;
  return result;
}

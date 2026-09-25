import { randomUUID } from "node:crypto";
import type { AgentImageHostResult } from "../../shared/agent-image";

import { normalize_app_language } from "../../domain/app-language";
import { normalize_log_error, to_log_error, type LogError } from "../../shared/error";
import type {
  BackendRuntimeHostOperation,
  BackendRuntimeMainMessage,
  BackendRuntimeReady,
  BackendRuntimeResult,
  BackendRuntimeWorkerMessage,
} from "../../shared/backend-runtime";
import { t_main_log } from "../log/log-text";
import {
  build_worker_threads_backend_worker_execution_from_desktop_bundle_dir,
  resolve_desktop_bundle_dir_from_module_url,
} from "../worker/worker-execution";
import { GuiBackendBootstrap } from "./gui-backend-bootstrap";

/** runtime 只依赖 parentPort 的消息能力，不把完整 MessagePort API 泄漏进生命周期实现。 */
export type BackendRuntimePort = {
  postMessage: (message: BackendRuntimeWorkerMessage) => void;
  on: (event: "message", listener: (message: BackendRuntimeMainMessage) => void) => void;
  close?: () => void;
};

type PendingHostRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  signal: AbortSignal | undefined; // Agent stop 的原始取消来源
  abortListener?: () => void; // 结算时必须解绑，避免长会话积累监听器
};

/** GUI Backend 的完整生命周期只存在于 runtime worker 内。 */
export async function run_backend_runtime(args: {
  appRoot: string; // 安装根继续决定版本与便携数据位置
  builtinRoot: string; // 当前版本只读内置资产根
  moduleUrl: string;
  workspaceRuntimeDirectory: string;
  port: BackendRuntimePort;
}): Promise<void> {
  const pending_host_requests = new Map<string, PendingHostRequest>(); // requestId 隔离并发宿主回调
  // 原生宿主操作不支持中止；取消只结束 worker 的等待，迟到回包由 requestId 丢弃。
  const call_host = async (
    operation: BackendRuntimeHostOperation,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    signal?.throwIfAborted();
    const request_id = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const pending: PendingHostRequest = {
        resolve,
        reject,
        signal,
      };
      pending_host_requests.set(request_id, pending);
      if (signal !== undefined) {
        const abort_listener = () => {
          if (operation.kind === "print_pdf" || operation.kind === "prepare_image") {
            args.port.postMessage({ type: "host_cancel", requestId: request_id });
            return; // 等窗口释放后的回包，工作区互斥仍由原调用持有。
          }
          pending_host_requests.delete(request_id);
          reject(signal.reason);
        };
        pending.abortListener = abort_listener;
        signal.addEventListener("abort", abort_listener, { once: true });
      }
    });
    args.port.postMessage({ type: "host_request", requestId: request_id, operation });
    return await result;
  };
  const reject_pending_host_requests = (reason: unknown): void => {
    for (const pending of pending_host_requests.values()) {
      if (pending.signal !== undefined && pending.abortListener !== undefined) {
        pending.signal.removeEventListener("abort", pending.abortListener);
      }
      pending.reject(reason);
    }
    pending_host_requests.clear();
  };
  const desktop_bundle_dir = resolve_desktop_bundle_dir_from_module_url(args.moduleUrl);
  // 普通模型请求与 Node fetch 共用同一宿主解析端口，避免两套代理事实漂移。
  const system_proxy_resolver = {
    resolveProxy: async (url: string, signal?: AbortSignal) =>
      String(await call_host({ kind: "resolve_proxy", url }, signal)),
  };
  const bootstrap = new GuiBackendBootstrap({
    imageHost: async (operation, signal) => {
      const result = (await call_host(operation, signal)) as AgentImageHostResult;
      signal.throwIfAborted();
      return result;
    },
    pdfHost: async (operation, signal) => {
      const result = await call_host(operation, signal);
      signal?.throwIfAborted();
      if (!(result instanceof Uint8Array)) throw new TypeError("Invalid PDF host bytes.");
      return result;
    },
    appRoot: args.appRoot,
    builtinRoot: args.builtinRoot,
    systemProxyResolver: system_proxy_resolver,
    openDirectory: async (path) => {
      await call_host({ kind: "open_directory", path });
    },
    pickSavePath: async (defaultName) => {
      const result = await call_host({ kind: "pick_save_path", defaultName });
      if (result !== null && (typeof result !== "string" || result === "")) {
        throw new TypeError("Invalid save path response.");
      }
      return result;
    },
    workspaceRuntimeDirectory: args.workspaceRuntimeDirectory,
    workerExecution:
      build_worker_threads_backend_worker_execution_from_desktop_bundle_dir(desktop_bundle_dir),
  });
  let start_result: Awaited<ReturnType<GuiBackendBootstrap["start"]>> | null = null; // ready 前禁止控制消息读取服务

  args.port.on("message", (message) => {
    if (message.type === "host_response") {
      const pending = pending_host_requests.get(message.requestId);
      if (pending === undefined) return;
      pending_host_requests.delete(message.requestId);
      if (pending.signal !== undefined && pending.abortListener !== undefined) {
        pending.signal.removeEventListener("abort", pending.abortListener);
      }
      if (message.result.ok) pending.resolve(message.result.data);
      else pending.reject(to_error(message.result.error));
      return;
    }
    void handle_control_message(message);
  });

  const respond = (request_id: string, result: BackendRuntimeResult): void => {
    args.port.postMessage({ type: "response", requestId: request_id, result });
  };
  // 控制请求各自结算为 response；业务异常不得逃逸成 worker 级未处理拒绝。
  const handle_control_message = async (
    message: Exclude<BackendRuntimeMainMessage, { type: "host_response" }>,
  ): Promise<void> => {
    try {
      if (message.type === "stop") {
        reject_pending_host_requests(new Error("Backend runtime is closed."));
        await bootstrap.stop();
        respond(message.requestId, { ok: true, data: null });
        args.port.close?.();
        return;
      }
      if (start_result === null) throw new Error("Backend runtime is not ready.");
      if (message.type === "read_app_language") {
        respond(message.requestId, {
          ok: true,
          data: normalize_app_language(start_result.readAppLanguage()),
        });
        return;
      }
      const log_manager = start_result.backendServices.logManager;
      log_manager[message.level](t_main_log(message.messageKey), {
        source: "electron-main",
        ...(message.error === undefined ? {} : { error: message.error }),
        ...(message.context === undefined ? {} : { context: message.context }),
      });
      respond(message.requestId, { ok: true, data: null });
    } catch (error) {
      respond(message.requestId, { ok: false, error: to_log_error(error) });
    }
  };

  try {
    start_result = await bootstrap.start();
    const ready: BackendRuntimeReady = {
      apiBaseUrl: start_result.apiBaseUrl,
      appVersion: start_result.backendServices.app.metadata.read_version(),
      berserkerUpdateRootDir:
        start_result.backendServices.app.paths.get_berserker_update_root_dir(),
    };
    args.port.postMessage({ type: "ready", data: ready });
  } catch (error) {
    args.port.postMessage({ type: "start_failed", error: to_log_error(error) });
    reject_pending_host_requests(error);
    await bootstrap.stop().catch(() => undefined);
    args.port.close?.();
  }
}

/** 把跨线程日志错误恢复为保留名称和调用栈的本地 Error。 */
function to_error(error: LogError): Error {
  const normalized = normalize_log_error(error, "Backend runtime 宿主调用失败。");
  const result = new Error(normalized.message);
  result.name = normalized.name ?? "BackendRuntimeHostError";
  if (normalized.stack === undefined) delete result.stack;
  else result.stack = normalized.stack;
  return result;
}

import { randomUUID } from "node:crypto";

import { normalize_app_language } from "../../domain/app-language";
import { normalize_log_error, to_log_error, type LogError } from "../../shared/error";
import type {
  AgentWorkspaceRuntimePaths,
  BackendRuntimeHostOperation,
  BackendRuntimeMainMessage,
  BackendRuntimeReady,
  BackendRuntimeResult,
  BackendRuntimeWorkerMessage,
} from "../../shared/backend-runtime";
import { DenoAgentWorkspaceRunner } from "../agent/workspace/runtime/runner";
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
  signal?: AbortSignal; // Agent stop 的原始取消来源
  abortListener?: () => void; // 结算时必须解绑，避免长会话积累监听器
  dispatched: boolean; // 已发给 main 的请求必须等待宿主清理回执
  cancelled: boolean; // 防止同一 signal 重复发送 host_cancel
  cancelReason?: unknown;
};

/** GUI Backend 的完整生命周期只存在于 runtime worker 内。 */
export async function run_backend_runtime(args: {
  appRoot: string; // 安装根继续决定版本与便携数据位置
  builtinRoot: string; // 当前版本只读内置资产根
  moduleUrl: string;
  agentWorkspaceRuntime: AgentWorkspaceRuntimePaths;
  port: BackendRuntimePort;
}): Promise<void> {
  const pending_host_requests = new Map<string, PendingHostRequest>(); // requestId 隔离并发宿主回调
  // Electron 专属能力反向交给 main 执行，Backend worker 不导入 Electron。
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
        dispatched: false,
        cancelled: false,
      };
      pending_host_requests.set(request_id, pending);
      if (signal !== undefined) {
        const abort_listener = () => {
          if (!pending_host_requests.has(request_id) || pending.cancelled) return;
          pending.cancelled = true;
          pending.cancelReason = signal.reason;
          if (pending.dispatched) {
            args.port.postMessage({ type: "host_cancel", requestId: request_id });
          } else {
            pending_host_requests.delete(request_id);
            signal.removeEventListener("abort", abort_listener);
            reject(signal.reason);
          }
        };
        pending.abortListener = abort_listener;
        signal.addEventListener("abort", abort_listener, { once: true });
        if (signal.aborted) abort_listener();
      }
    });
    if (pending_host_requests.has(request_id)) {
      const pending = pending_host_requests.get(request_id);
      if (pending !== undefined) pending.dispatched = true;
      args.port.postMessage({ type: "host_request", requestId: request_id, operation });
    }
    return await result;
  };
  const reject_pending_host_requests = (reason: unknown): void => {
    for (const [request_id, pending] of pending_host_requests) {
      if (pending.signal !== undefined && pending.abortListener !== undefined) {
        pending.signal.removeEventListener("abort", pending.abortListener);
      }
      args.port.postMessage({ type: "host_cancel", requestId: request_id });
      pending.reject(reason);
    }
    pending_host_requests.clear();
  };
  const desktop_bundle_dir = resolve_desktop_bundle_dir_from_module_url(args.moduleUrl);
  // 普通模型请求与 Deno fetch 共用同一宿主解析端口，避免两套代理事实漂移。
  const system_proxy_resolver = {
    resolveProxy: async (url: string, signal?: AbortSignal) =>
      String(await call_host({ kind: "resolve_proxy", url }, signal)),
  };
  const agent_workspace_runner = new DenoAgentWorkspaceRunner({
    executablePath: args.agentWorkspaceRuntime.denoExecutablePath,
    runtimeEntryPath: args.agentWorkspaceRuntime.runtimeEntryPath,
    systemProxyResolver: system_proxy_resolver,
  });
  const bootstrap = new GuiBackendBootstrap({
    appRoot: args.appRoot,
    builtinRoot: args.builtinRoot,
    systemProxyResolver: system_proxy_resolver,
    openOutputFolder: async (output_path) => {
      await call_host({ kind: "open_output_folder", path: output_path });
    },
    agentWorkspaceRun: agent_workspace_runner.run.bind(agent_workspace_runner),
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
      if (pending.cancelled) pending.reject(pending.cancelReason);
      else if (message.result.ok) pending.resolve(message.result.data);
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
    await agent_workspace_runner.initialize();
    start_result = await bootstrap.start();
    const ready: BackendRuntimeReady = {
      apiBaseUrl: start_result.apiBaseUrl,
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
  result.stack = normalized.stack;
  return result;
}

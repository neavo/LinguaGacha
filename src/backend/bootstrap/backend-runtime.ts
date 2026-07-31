import { randomUUID } from "node:crypto";

import { normalize_app_language } from "../../domain/app-language";
import { normalize_log_error, to_log_error, type LogError } from "../../shared/error";
import type {
  BackendRuntimeHostOperation,
  BackendRuntimeMainMessage,
  BackendRuntimeReady,
  BackendRuntimeResult,
  BackendRuntimeWorkerMessage,
} from "../../shared/backend-runtime";
import { AppPathService } from "../app/app-path-service";
import { t_main_log } from "../log/log-text";
import {
  build_worker_threads_backend_worker_execution_from_desktop_bundle_dir,
  resolve_desktop_bundle_dir_from_module_url,
} from "../worker/worker-execution";
import { BackendBootstrap } from "./backend-bootstrap";

/** runtime 只依赖 parentPort 的消息能力，不把完整 MessagePort API 泄漏进生命周期实现。 */
export type BackendRuntimePort = {
  postMessage: (message: BackendRuntimeWorkerMessage) => void;
  on: (event: "message", listener: (message: BackendRuntimeMainMessage) => void) => void;
  close?: () => void;
};

type PendingHostRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/** GUI Backend 的完整生命周期只存在于 runtime worker 内。 */
export async function run_backend_runtime(args: {
  appRoot: string;
  moduleUrl: string;
  port: BackendRuntimePort;
}): Promise<void> {
  const pending_host_requests = new Map<string, PendingHostRequest>(); // requestId 隔离并发宿主回调
  // Electron 专属能力反向交给 main 执行，Backend worker 不导入 Electron。
  const call_host = async (operation: BackendRuntimeHostOperation): Promise<unknown> => {
    const request_id = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      pending_host_requests.set(request_id, { resolve, reject });
    });
    args.port.postMessage({ type: "host_request", requestId: request_id, operation });
    return await result;
  };
  const desktop_bundle_dir = resolve_desktop_bundle_dir_from_module_url(args.moduleUrl);
  const bootstrap = new BackendBootstrap({
    appRoot: args.appRoot,
    exposeApiGateway: true,
    systemProxyResolver: {
      resolveProxy: async (url) => String(await call_host({ kind: "resolve_proxy", url })),
    },
    openOutputFolder: async (output_path) => {
      await call_host({ kind: "open_output_folder", path: output_path });
    },
    workerExecution:
      build_worker_threads_backend_worker_execution_from_desktop_bundle_dir(desktop_bundle_dir),
  });
  let start_result: Awaited<ReturnType<BackendBootstrap["start"]>> | null = null;

  args.port.on("message", (message) => {
    if (message.type === "host_response") {
      const pending = pending_host_requests.get(message.requestId);
      if (pending === undefined) return;
      pending_host_requests.delete(message.requestId);
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
        await bootstrap.stop();
        respond(message.requestId, { ok: true, data: null });
        args.port.close?.();
        return;
      }
      if (start_result === null) throw new Error("Backend runtime 尚未就绪。");
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
    if (start_result.apiBaseUrl === null) throw new Error("GUI Backend API 未公开。");
    const paths = new AppPathService({ appRoot: args.appRoot });
    const ready: BackendRuntimeReady = {
      apiBaseUrl: start_result.apiBaseUrl,
      berserkerUpdateRootDir: paths.get_berserker_update_root_dir(),
      systemProxyStartupNotice: start_result.systemProxyStartupNotice,
    };
    args.port.postMessage({ type: "ready", data: ready });
  } catch (error) {
    args.port.postMessage({ type: "start_failed", error: to_log_error(error) });
    await bootstrap.stop().catch(() => undefined);
    args.port.close?.();
  }
}

function to_error(error: LogError): Error {
  const normalized = normalize_log_error(error, "Backend runtime 宿主调用失败。");
  const result = new Error(normalized.message);
  result.name = normalized.name ?? "BackendRuntimeHostError";
  result.stack = normalized.stack;
  return result;
}

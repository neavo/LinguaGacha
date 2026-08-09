import type { LogError, LogErrorContext } from "./error";
import type { LocaleKey } from "./i18n";
import type { JsonRecord, JsonValue } from "../domain/json";

/** Backend 启动完成后 main 创建窗口所需的最小可克隆快照。 */
export type BackendRuntimeReady = {
  apiBaseUrl: string;
  berserkerUpdateRootDir: string;
  systemProxyStartupNotice: {
    detected: boolean;
    proxiedOriginCount: number;
    proxyDisplay: string | null;
  };
};

/** 所有控制请求和宿主回调共用的成功/失败信封。 */
export type BackendRuntimeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: LogError };

export type BackendRuntimeWebFetchRequest = Readonly<{
  url: string; // 模型请求的原始公开 HTTP(S) URL
}>;

/** main 完成安全下载后传给 Backend 的有限、可克隆响应。 */
export type BackendRuntimeWebFetchResponse = Readonly<{
  requestedUrl: string; // 调用方请求 URL，用于区分最终重定向地址
  url: string; // 经过逐跳校验后的最终 URL
  status: number; // 当前仅允许 2xx，保留字段用于明确宿主契约
  contentType: string; // 原始响应头，由 Backend 决定正文归一方式
  body: Uint8Array; // 已受宿主字节上限约束的原始响应体
}>;

/** 单次工作区操作进入模型历史前允许返回的最大 UTF-8 JSON 字节数。 */
export const AGENT_WORKSPACE_MAX_RESULT_BYTES = 128 * 1024;

/** Backend 只把当前工作区身份与已校验操作交给受信任 Electron main。 */
export type BackendRuntimeAgentWorkspaceRunRequest = Readonly<{
  workspacePath: string;
  operation:
    | Readonly<{ kind: "script"; script: string }>
    | Readonly<{ kind: "recipe"; name: string; args: JsonRecord }>;
}>;

/** 已知执行失败显式声明工作区是否仍可继续使用。 */
export type BackendRuntimeAgentWorkspaceRunResponse =
  | Readonly<{ status: "success"; result: JsonValue }>
  | Readonly<{
      status: "failed";
      workspaceState: "preserved" | "invalidated";
      failure: "execution_failed" | "transaction_failed" | "workspace_invalid";
      message: string;
    }>;

/** 必须留在 Electron main 执行的宿主能力。 */
export type BackendRuntimeHostOperation =
  | { kind: "resolve_proxy"; url: string }
  | { kind: "open_output_folder"; path: string }
  | { kind: "web_fetch"; request: BackendRuntimeWebFetchRequest }
  | { kind: "run_agent_workspace"; request: BackendRuntimeAgentWorkspaceRunRequest };

export type BackendRuntimeDiagnosticLevel = "warning" | "error" | "fatal";

/** Electron main 发往 Backend Runtime worker 的控制消息。 */
export type BackendRuntimeMainMessage =
  | { type: "stop"; requestId: string }
  | { type: "read_app_language"; requestId: string }
  | {
      type: "record_host_diagnostic";
      requestId: string;
      level: BackendRuntimeDiagnosticLevel;
      messageKey: LocaleKey;
      error?: LogError;
      context?: LogErrorContext;
    }
  | {
      type: "host_response";
      requestId: string;
      result: BackendRuntimeResult;
    };

/** Backend Runtime worker 发往 Electron main 的生命周期与响应消息。 */
export type BackendRuntimeWorkerMessage =
  | { type: "ready"; data: BackendRuntimeReady }
  | { type: "start_failed"; error: LogError }
  | { type: "response"; requestId: string; result: BackendRuntimeResult }
  | { type: "host_cancel"; requestId: string }
  | {
      type: "host_request";
      requestId: string;
      operation: BackendRuntimeHostOperation;
    };

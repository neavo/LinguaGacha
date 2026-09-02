import type { LogError, LogErrorContext } from "./error";
import type { LocaleKey } from "./i18n";

/** Electron main 解析并跨线程传递的 Agent Workspace Runtime 固定资产。 */
export type AgentWorkspaceRuntimePaths = Readonly<{
  denoExecutablePath: string; // 当前目标的固定版本 Deno 可执行文件
  runtimeEntryPath: string; // 与应用构建同步生成的自包含 runtime bundle
}>;

/** Backend 启动完成后 main 创建窗口所需的最小可克隆快照。 */
export type BackendRuntimeReady = {
  apiBaseUrl: string;
  berserkerUpdateRootDir: string;
};

/** 所有控制请求和宿主回调共用的成功/失败信封。 */
export type BackendRuntimeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: LogError };

/** 必须留在 Electron main 执行的宿主能力。 */
export type BackendRuntimeHostOperation =
  | { kind: "resolve_proxy"; url: string }
  | { kind: "open_output_folder"; path: string };

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

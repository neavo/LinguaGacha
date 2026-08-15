import type { LogError, LogErrorContext } from "./error";
import type { LocaleKey } from "./i18n";
import type { JsonValue } from "../domain/json";

/** Backend 启动完成后 main 创建窗口所需的最小可克隆快照。 */
export type BackendRuntimeReady = {
  apiBaseUrl: string;
  berserkerUpdateRootDir: string;
};

/** 所有控制请求和宿主回调共用的成功/失败信封。 */
export type BackendRuntimeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: LogError };

/** 单次工作区操作进入模型历史前允许返回的最大 UTF-8 JSON 字节数。 */
export const AGENT_WORKSPACE_MAX_RESULT_BYTES = 128 * 1024;

/** Backend 与 Electron main 共用的对话级任务目录挂载名。 */
export const AGENT_WORKSPACE_TASK_ROOT = "task";

/** workspace_script 在首次调用前通过工具 Schema 公开的完整固定 SDK。 */
export const AGENT_WORKSPACE_SCRIPT_API = Object.freeze({
  members: Object.freeze({
    contract:
      ": WorkspaceContract（当前工作区的 limits、datasets、changes、effects、guidance、apply 与 recipes 契约）",
    readText: "(path: string): Promise<string>",
    readJson: "(path: string): Promise<JsonValue>",
    iterateLines: "(path: string): AsyncIterable<string>",
    iterateJsonl: "(path: string): AsyncIterable<JsonValue>",
    writeText: "(path: string, text: string): Promise<void>",
    writeJson: "(path: string, value: JsonValue): Promise<void>",
    writeJsonl:
      "(path: string, rows: Iterable<JsonValue> | AsyncIterable<JsonValue>): Promise<void>",
    list: "(path?: string): Promise<Array<{ name: string, type: 'file' | 'directory', size_bytes?: number }>>",
    remove: "(path: string): Promise<void>",
    runRecipe: "(name: string, args: object): Promise<JsonValue>",
    matchLiterals:
      "(args: { patterns: Array<{ key: string, text: string, case_sensitive: boolean }>; examples_per_pattern?: number }): Promise<{ scanned_item_count: number; matched_item_count: number; patterns: Array<{ key: string; matched_item_count: number; field_item_counts: { src: number; name_src: number }; example_matches: Array<{ item_id: number; field: 'src' | 'name_src'; ranges: Array<{ start: number; end: number }> }> }> }>",
  }),
  roots: Object.freeze({
    task: `${AGENT_WORKSPACE_TASK_ROOT}/**`,
    scratch: "scratch/**",
  }),
});

/** 单个字面模式最多回传的证据条目数，主进程协议与公开 contract 共用。 */
export const AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES = 50;

/** Backend 只把当前工作区身份与完整脚本入口交给受信任 Electron main。 */
export type BackendRuntimeAgentWorkspaceRunRequest = Readonly<{
  workspacePath: string;
  script: string;
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

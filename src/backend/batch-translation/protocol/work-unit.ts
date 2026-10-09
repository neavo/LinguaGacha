import { is_json_record } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import { read_log_content } from "../../../shared/log";
import type { TranslationRequestPort } from "./translation-request";
import type { Model } from "../../../domain/model";
import type { SettingSnapshot } from "../../../domain/setting";
import type { TextQualitySnapshot, TextTaskItemRecord } from "../../../shared/text/text-processing";
import type { LogError } from "../../../shared/error";
import type { LogContent } from "../../../shared/log";

/** worker 只回传任务结果日志，普通生命周期文本由主线程生成。 */
type WorkUnitLogContent = Extract<LogContent, { kind: "translation_result" }>;

/** work unit 日志只允许可序列化摘要，避免 worker 线程回传 Error 引用 */
export type WorkUnitLogEntry = {
  level: "info" | "warning" | "error"; // 主线程回放时使用的公开日志等级
  content: WorkUnitLogContent; // 跨线程传输的结构化任务结果
  error?: LogError; // 已在 worker 边界收窄的可序列化错误
};

/** 翻译 work unit 是 BatchTranslationRunner 发给 worker 的不可变执行载荷 */
export type TranslationWorkUnit = {
  unit_id: string;
  run_id: string;
  kind: "translation";
  model: TranslationModelSnapshot;
  config_snapshot: SettingSnapshot;
  quality_snapshot: TextQualitySnapshot;
  payload: {
    items: TextTaskItemRecord[];
    precedings: TextTaskItemRecord[];
  };
  diagnostics: {
    token_threshold: number;
    split_count: number;
    retry_count: number;
    is_initial: boolean;
  };
};

export type TranslationModelSnapshot = Pick<
  Model,
  | "id"
  | "type"
  | "name"
  | "api_format"
  | "api_url"
  | "api_key"
  | "auth_type"
  | "model_id"
  | "agent"
  | "request"
  | "threshold"
  | "thinking"
  | "generation"
>;

/**
 * BatchTranslationRunner 调用的 work unit executor 端口，屏蔽 worker_threads 和 LLM adapter 细节
 */
export interface WorkUnitExecutor {
  /**
   * 执行后台任务 work unit，返回结果但不直接写数据库
   */
  execute_unit(
    unit: TranslationWorkUnit,
    signal: AbortSignal,
    request_client: TranslationRequestPort,
  ): Promise<WorkUnitExecutionResult>;
}

/** 翻译 work unit 输出只表达译文 item 更新，数据库提交由 BatchTranslationRunner 统一编排 */
export type TranslationWorkUnitOutput = {
  kind: "translation";
  items: TextTaskItemRecord[];
};

/** worker 传输边界只接受完整的翻译结果与有限计数。 */
export function read_translation_worker_result(value: unknown): WorkUnitExecutionResult {
  if (
    !is_json_record(value) ||
    typeof value["unit_id"] !== "string" ||
    value["kind"] !== "translation" ||
    !["success", "failed", "stopped"].includes(String(value["outcome"]))
  )
    throw new AppError("worker.execution_failed");
  const metrics = value["metrics"];
  const output = value["output"];
  const logs = value["logs"];
  if (
    !is_json_record(metrics) ||
    !["input_tokens", "reasoning_tokens", "output_tokens"].every(
      (key) =>
        typeof metrics[key] === "number" && Number.isFinite(metrics[key]) && metrics[key] >= 0,
    ) ||
    !is_json_record(output) ||
    output["kind"] !== "translation" ||
    !Array.isArray(output["items"]) ||
    !output["items"].every(is_json_record) ||
    !Array.isArray(logs) ||
    !logs.every((log) => {
      if (!is_json_record(log) || !["info", "warning", "error"].includes(String(log["level"])))
        return false;
      const content = read_log_content(log["content"]);
      return (
        content !== null && typeof content !== "string" && content.kind === "translation_result"
      );
    })
  )
    throw new AppError("worker.execution_failed");
  return value as unknown as WorkUnitExecutionResult;
}

/** WorkUnitExecutionResult 是 work unit worker 回传 BatchTranslationRunner 的统一结果信封 */
export type WorkUnitExecutionResult = {
  unit_id: string;
  kind: "translation";
  outcome: "success" | "failed" | "stopped"; // 驱动 BatchTranslationRunner 重试、停止和结果提交分支
  metrics: {
    input_tokens: number;
    reasoning_tokens: number; // 思考 token 子集
    output_tokens: number; // 已扣除思考 token 的输出
  };
  output: TranslationWorkUnitOutput;
  logs: WorkUnitLogEntry[];
};

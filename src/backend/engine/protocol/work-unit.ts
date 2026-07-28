import type { JsonValue } from "../../../domain/json";
import type { LogError } from "../../../shared/error";
import type { LogContent } from "../../../shared/log";

/** worker 只回传任务结果日志，普通生命周期文本由主线程生成。 */
type WorkUnitLogContent = Extract<LogContent, { kind: "translation_result" | "analysis_result" }>;

/** work unit 日志只允许可序列化摘要，避免 worker 线程回传 Error 引用 */
export type WorkUnitLogEntry = {
  level: "info" | "warning" | "error"; // 主线程回放时使用的公开日志等级
  content: WorkUnitLogContent; // 跨线程传输的结构化任务结果
  error?: LogError; // 已在 worker 边界收窄的可序列化错误
};

/** 翻译 work unit 是 Engine 发给 worker 的不可变执行载荷 */
export type TranslationWorkUnit = {
  unit_id: string;
  run_id: string;
  kind: "translation";
  model: JsonValue;
  config_snapshot: JsonValue;
  quality_snapshot: JsonValue;
  payload: {
    items: JsonValue;
    precedings: JsonValue;
  };
  diagnostics: {
    token_threshold: number;
    split_count: number;
    retry_count: number;
    is_initial: boolean;
  };
};

/** 分析 work unit 固定围绕单文件条目运行，checkpoint 解释留在 Engine/store 边界 */
export type AnalysisWorkUnit = {
  unit_id: string;
  run_id: string;
  kind: "analysis";
  model: JsonValue;
  config_snapshot: JsonValue;
  quality_snapshot: JsonValue;
  payload: {
    file_path: string;
    items: JsonValue;
  };
  diagnostics: {
    retry_count: number;
  };
};

/** WorkUnit 是 worker execute_unit 唯一入口载荷 */
export type WorkUnit = TranslationWorkUnit | AnalysisWorkUnit;

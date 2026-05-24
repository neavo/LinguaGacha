import type { ApiJsonValue } from "../../api/api-types";

/** work unit 日志只允许可序列化摘要，避免 worker 线程回传 Error 引用 */
export type WorkUnitLogEntry = {
  level: "info" | "warning" | "error";
  message: string;
  error_message?: string;
  stack?: string;
  context?: Record<string, ApiJsonValue>;
};

/** 翻译 work unit 是 Engine 发给 worker 的不可变执行载荷 */
export type TranslationWorkUnit = {
  unit_id: string;
  run_id: string;
  kind: "translation";
  model: ApiJsonValue;
  config_snapshot: ApiJsonValue;
  quality_snapshot: ApiJsonValue;
  payload: {
    items: ApiJsonValue;
    precedings: ApiJsonValue;
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
  model: ApiJsonValue;
  config_snapshot: ApiJsonValue;
  quality_snapshot: ApiJsonValue;
  payload: {
    file_path: string;
    items: ApiJsonValue;
  };
  diagnostics: {
    retry_count: number;
  };
};

/** WorkUnit 是 worker execute_unit 唯一入口载荷 */
export type WorkUnit = TranslationWorkUnit | AnalysisWorkUnit;

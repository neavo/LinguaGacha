import type { Model } from "../../../domain/model";
import type { SettingSnapshot } from "../../../domain/setting";
import type { TextQualitySnapshot, TextTaskItemRecord } from "../../../shared/text/text-types";
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

/** TranslationWorkUnit 是 worker execute_unit 唯一入口载荷 */

export type TranslationModelSnapshot = Pick<
  Model,
  | "id"
  | "type"
  | "name"
  | "api_format"
  | "api_url"
  | "api_key"
  | "model_id"
  | "agent"
  | "request"
  | "threshold"
  | "thinking"
  | "generation"
>;

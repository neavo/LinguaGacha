import type { JsonValue } from "../../../domain/json";
import type { WorkUnitLogEntry } from "./work-unit";

/** 翻译 work unit 输出只表达译文 item 更新，数据库提交由 TaskEngine 统一编排 */
export type TranslationWorkUnitOutput = {
  kind: "translation";
  items: JsonValue;
  row_count: number;
};

/** 分析 work unit 输出只表达候选术语原始结果，checkpoint 由 Engine 解释 */
export type AnalysisWorkUnitOutput = {
  kind: "analysis";
  glossary_entries: JsonValue;
  valid_empty_result: boolean;
};

/** WorkUnitExecutionResult 是 work unit worker 回传 Engine 的统一结果信封 */
export type WorkUnitExecutionResult = {
  unit_id: string;
  kind: "translation" | "analysis";
  outcome: "success" | "failed" | "stopped"; // 驱动 Engine 重试、停止和结果提交分支
  metrics: {
    input_tokens: number;
    reasoning_tokens: number; // 思考 token 子集
    output_tokens: number; // 已扣除思考 token 的输出
  };
  output: TranslationWorkUnitOutput | AnalysisWorkUnitOutput;
  logs: WorkUnitLogEntry[];
};

import type { ApiJsonValue } from "../../api/api-types";
import type { WorkUnitLogEntry } from "./work-unit";

/** 翻译 work unit 输出只表达译文 item 更新，数据库提交由 artifact 层完成 */
export type TranslationWorkUnitOutput = {
  kind: "translation";
  items: ApiJsonValue;
  row_count: number;
};

/** 分析 work unit 输出只表达候选术语原始结果，checkpoint 由 Engine 解释 */
export type AnalysisWorkUnitOutput = {
  kind: "analysis";
  glossary_entries: ApiJsonValue;
  valid_empty_result: boolean;
};

/** WorkUnitExecutionResult 是 work unit worker 回传 Engine 的统一结果信封 */
export type WorkUnitExecutionResult = {
  unit_id: string;
  kind: "translation" | "analysis";
  outcome: "success" | "failed" | "stopped"; // outcome 驱动 Engine 重试、停止和 artifact 提交分支
  metrics: {
    input_tokens: number;
    output_tokens: number;
  };
  output: TranslationWorkUnitOutput | AnalysisWorkUnitOutput;
  logs: WorkUnitLogEntry[];
};

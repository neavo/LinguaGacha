import { is_json_record } from "../../../domain/json";
import type { TextTaskItemRecord } from "../../../shared/text/text-types";
import { AppError } from "../../../shared/error";
import { read_log_content } from "../../../shared/log";
import type { WorkUnitLogEntry } from "./work-unit";

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
    !logs.every(
      (log) =>
        is_json_record(log) &&
        ["info", "warning", "error"].includes(String(log["level"])) &&
        read_log_content(log["content"])?.kind === "translation_result",
    )
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

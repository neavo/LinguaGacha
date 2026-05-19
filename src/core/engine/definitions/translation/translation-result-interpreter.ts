import type { WorkerExecutionResult } from "../../protocol/worker-result";
import type { WorkerResultInterpretation } from "../task-definition";

/**
 * 翻译结果解释入口；artifact 生成迁入前保持无副作用空解释
 */
export function interpret_translation_worker_result(
  _result: WorkerExecutionResult,
): WorkerResultInterpretation {
  return { retry_units: [], artifacts: [], progress_delta: {}, terminal_error: null };
}

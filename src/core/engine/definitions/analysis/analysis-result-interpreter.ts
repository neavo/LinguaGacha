import type { WorkerExecutionResult } from "../../protocol/worker-result";
import type { WorkerResultInterpretation } from "../task-definition";

/**
 * 分析结果解释入口；候选与 checkpoint artifact 迁入前保持空解释
 */
export function interpret_analysis_worker_result(
  _result: WorkerExecutionResult,
): WorkerResultInterpretation {
  return { retry_units: [], artifacts: [], progress_delta: {}, terminal_error: null };
}

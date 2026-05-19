import type { WorkUnitExecutionResult } from "../../protocol/work-unit-result";
import type { WorkerResultInterpretation } from "../task-definition";

/**
 * 分析结果解释入口；候选与 checkpoint artifact 迁入前保持空解释
 */
export function interpret_analysis_worker_result(
  _result: WorkUnitExecutionResult,
): WorkerResultInterpretation {
  return { retry_units: [], artifacts: [], progress_delta: {}, terminal_error: null };
}

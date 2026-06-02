import type { WorkUnit } from "../protocol/work-unit";
import type { WorkUnitExecutionResult } from "../protocol/work-unit-result";

/**
 * TaskEngine 调用的 work unit executor 端口，屏蔽 worker_threads 和 LLM adapter 细节
 */
export interface WorkUnitExecutor {
  /**
   * 执行后台任务 work unit，返回结果但不直接写数据库
   */
  execute_unit(unit: WorkUnit, signal: AbortSignal): Promise<WorkUnitExecutionResult>;
}

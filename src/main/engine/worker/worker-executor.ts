import type { ApiJsonValue } from "../../api/api-types";
import type { WorkUnit } from "../protocol/work-unit";
import type { WorkerExecutionResult } from "../protocol/worker-result";

/**
 * TaskEngine 调用的 work unit executor 端口，屏蔽 worker_threads 和 LLM adapter 细节
 */
export interface WorkerExecutor {
  /**
   * 执行后台任务 work unit，返回结果但不直接写数据库
   */
  execute_unit(
    unit: WorkUnit,
    signal: AbortSignal,
  ): Promise<WorkerExecutionResult>;

  /**
   * 执行公开单条翻译工具调用，只返回派生结果和诊断日志
   */
  translate_single(
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<
    Record<string, ApiJsonValue> & {
      logs?: Array<{ level: "info" | "warning" | "error"; message: string }>;
    }
  >;
}


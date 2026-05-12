import type { ApiJsonValue } from "../api/api-types";
import type {
  AnalysisWorkUnitResult,
  TranslationWorkUnitResult,
} from "./work-unit/work-unit-types";

/**
 * TaskEngine 调用的 work unit executor 端口，屏蔽 worker_threads 和 LLM adapter 细节
 */
export interface TaskWorkUnitExecutor {
  /**
   * 执行普通翻译 chunk，返回结果但不直接写数据库
   */
  execute_translation_chunk(
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult>;

  /**
   * 执行术语分析 chunk，候选提交与 checkpoint 由 TaskEngine 负责
   */
  execute_analysis_chunk(
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<AnalysisWorkUnitResult>;

  /**
   * 执行单条重翻，复用翻译返回形状以保持提交流程一致
   */
  execute_retranslate_item(
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult>;

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

/**
 * worker 或 LLM adapter 传输失败时使用专门错误，翻译 chunk 可走可恢复重试
 */
export class WorkUnitExecutorTransportError extends Error {
  public readonly cause_error: unknown;

  /**
   * 保留原始异常链路，方便任务日志区分 worker 通道失败和业务失败
   */
  public constructor(message: string, cause_error: unknown) {
    super(message);
    this.name = "WorkUnitExecutorTransportError";
    this.cause_error = cause_error;
  }
}

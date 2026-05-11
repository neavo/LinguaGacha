import type { ApiJsonValue } from "../../api/api-types";
import { PiAiLlmRequestClient } from "../llm/llm-request-client";
import { AnalysisWorkUnitRunner } from "./analysis-work-unit-runner";
import { TranslationWorkUnitRunner } from "./translation-work-unit-runner";
import type {
  AnalysisWorkUnitRequest,
  RetranslateWorkUnitRequest,
  TranslateSingleWorkUnitRequest,
  TranslationWorkUnitRequest,
} from "./work-unit-types";

/**
 * worker 内 runner 的固定依赖，全部由 TaskWorkerPool 传入，避免 worker 自己读取进程环境。
 */
export interface WorkUnitRunnerOptions {
  // appRoot 用于读取资源模板和预设，不能从 worker 当前目录反推。
  appRoot: string;
}

/**
 * worker 内的统一分发器，保证入口文件只负责消息协议。
 */
export class WorkUnitRunner {
  private readonly translation_runner: TranslationWorkUnitRunner;
  private readonly analysis_runner: AnalysisWorkUnitRunner;

  /**
   * 每个 worker 持有自己的 runner 和 LLM client，避免跨线程共享可变对象。
   */
  public constructor(options: WorkUnitRunnerOptions) {
    const llm_client = new PiAiLlmRequestClient({ appRoot: options.appRoot });
    this.translation_runner = new TranslationWorkUnitRunner(options.appRoot, llm_client);
    this.analysis_runner = new AnalysisWorkUnitRunner(options.appRoot, llm_client);
  }

  /**
   * 按任务方法分发，未知方法在 worker 内直接报错。
   */
  public async run(
    method: string,
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (method === "execute_translation_chunk") {
      return this.translation_runner.execute_translation_chunk(
        body as unknown as TranslationWorkUnitRequest,
        signal,
      );
    }
    if (method === "execute_analysis_chunk") {
      return this.analysis_runner.execute_analysis_chunk(
        body as unknown as AnalysisWorkUnitRequest,
        signal,
      );
    }
    if (method === "execute_retranslate_item") {
      return this.translation_runner.execute_retranslate_item(
        body as unknown as RetranslateWorkUnitRequest,
        signal,
      );
    }
    if (method === "translate_single") {
      return this.translation_runner.translate_single(
        body as unknown as TranslateSingleWorkUnitRequest,
        signal,
      );
    }
    throw new Error(`未知 work-unit 方法：${method}`);
  }
}

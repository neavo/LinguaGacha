import type { WorkUnit } from "../protocol/work-unit";
import type { WorkUnitExecutionResult } from "../protocol/work-unit-result";
import type { LLMClientPort } from "../../llm/llm-types";
import { AnalysisWorkUnitRunner } from "./runners/analysis-runner";
import { TranslationWorkUnitRunner } from "./runners/translation-runner";

/**
 * worker 内 runner 的固定依赖，全部由 WorkUnitWorkerPool 传入，避免 worker 自己读取进程环境
 */
export interface WorkUnitRunnerOptions {
  appRoot: string; // 用于读取资源模板和预设，不能从 worker 当前目录反推
  llmClient: LLMClientPort; // 正式 worker 使用父线程 RPC，in_process 直接使用同一真实端口
}

/**
 * worker 内的统一分发器，保证入口文件只负责消息协议
 */
export class WorkUnitRunner {
  private readonly translation_runner: TranslationWorkUnitRunner;
  private readonly analysis_runner: AnalysisWorkUnitRunner;

  /**
   * runner 只持有中性 LLM 端口，真实网络所有权留在 Backend Runtime 父线程。
   */
  public constructor(options: WorkUnitRunnerOptions) {
    this.translation_runner = new TranslationWorkUnitRunner(options.appRoot, options.llmClient);
    this.analysis_runner = new AnalysisWorkUnitRunner(options.appRoot, options.llmClient);
  }

  /**
   * 按 unit.kind 分发，worker 不再理解业务 method string
   */
  public async run(unit: WorkUnit, signal: AbortSignal): Promise<WorkUnitExecutionResult> {
    if (unit.kind === "translation") {
      return this.translation_runner.execute_unit(unit, signal);
    }
    return this.analysis_runner.execute_unit(unit, signal);
  }
}

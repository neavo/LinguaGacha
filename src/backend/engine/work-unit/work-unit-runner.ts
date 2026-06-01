import type { ApiJsonValue } from "../../api/api-types";
import type { WorkUnit } from "../protocol/work-unit";
import type { WorkUnitExecutionResult } from "../protocol/work-unit-result";
import { LLMClient } from "../../llm/llm-client";
import { AppMetadataService } from "../../app/app-metadata-service";
import { AppPathService } from "../../app/app-path-service";
import { AnalysisWorkUnitRunner } from "./runners/analysis-runner";
import {
  TranslationWorkUnitRunner,
  type TranslateSingleWorkUnitRequest,
} from "./runners/translation-runner";

/**
 * worker 内 runner 的固定依赖，全部由 WorkUnitWorkerPool 传入，避免 worker 自己读取进程环境
 */
export interface WorkUnitRunnerOptions {
  appRoot: string; // 用于读取资源模板和预设，不能从 worker 当前目录反推
}

/**
 * worker 内的统一分发器，保证入口文件只负责消息协议
 */
export class WorkUnitRunner {
  private readonly translation_runner: TranslationWorkUnitRunner;
  private readonly analysis_runner: AnalysisWorkUnitRunner;

  /**
   * 每个 worker 持有自己的 runner 和 LLM client，避免跨线程共享可变对象
   */
  public constructor(options: WorkUnitRunnerOptions) {
    const paths = new AppPathService({ appRoot: options.appRoot }); // 让 worker 内 User-Agent 读取同一个应用根
    const metadata = new AppMetadataService(paths); // 在 worker 内只读取只读版本元信息
    const llm_client = new LLMClient({ userAgent: metadata.build_linguagacha_user_agent() });
    this.translation_runner = new TranslationWorkUnitRunner(options.appRoot, llm_client);
    this.analysis_runner = new AnalysisWorkUnitRunner(options.appRoot, llm_client);
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

  /**
   * 单条翻译是计算工具调用，不进入后台任务 unit
   */
  public async translate_single(
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.translation_runner.translate_single(
      body as unknown as TranslateSingleWorkUnitRequest,
      signal,
    );
  }
}

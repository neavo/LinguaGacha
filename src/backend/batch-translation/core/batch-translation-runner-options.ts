import type { LLMClientPort } from "../../llm/llm-types";
import type { TranslationContext } from "../planning/translation-plan-types";
import type { TextTaskItemRecord } from "../../../shared/text/text-types";
import type { LogManager } from "../../log/log-manager";
import type { SettingSnapshot } from "../../../domain/setting";
import type { TranslationModelSnapshot } from "../protocol/work-unit";

import type { BatchTranslationRuntime } from "../batch-translation-runtime";
import type { BatchTranslationProjectStore } from "../batch-translation-project-store";
import type { TranslationPlanner } from "../planning/translation-planner";
import type { WorkUnitExecutor } from "../work-unit/work-unit-executor";

/** Service 在运行 lease 内准备的单次执行上下文，Runner 与 worker 共用。 */
export type BatchTranslationRunContext = Readonly<{
  config_snapshot: SettingSnapshot;
  model: TranslationModelSnapshot;
}>;

/**
 * BatchTranslationRunner 依赖由 BackendServices 注入，保证后台任务只通过固定端口读写工程事实
 */
export interface BatchTranslationRunnerOptions {
  builtinRoot: string; // 用于任务启动日志读取提示词模板，保持宿主与 worker 内置资产根一致
  taskStore: Pick<
    BatchTranslationProjectStore,
    | "acquire_project_lease"
    | "build_quality_snapshot"
    | "commit_translation_batch"
    | "get_translation_items"
    | "update_translation_progress"
  >; // 任务编排器只依赖项目任务事实的公开能力
  taskRuntime: Pick<
    BatchTranslationRuntime,
    | "update_request_state"
    | "is_current"
    | "publish_progress"
    | "read_run_progress"
    | "publish_status"
    | "publish_config"
    | "read_progress"
  >; // 任务锁、取消、快照和请求压力的最小能力集合
  llmClient: LLMClientPort; // 每轮请求调度器使用的单次网络请求入口。
  executorClient: WorkUnitExecutor; // 屏蔽 worker_threads 与直接 runner 的传输差异
  taskPlanner: Pick<TranslationPlanner, "build_translation_plan" | "build_translation_retry_plan">; // 精确 token 切块、cache 复用和后台规划的最小能力集合
  logManager: Pick<LogManager, "append">; // 生命周期与批次日志共用结构化追加入口。
}

/** 批次提交携带终态条目与本次用量，也支持仅用量提交。 */
export interface TranslationCommitEntry {
  items: TextTaskItemRecord[];
  input_tokens: number;
  reasoning_tokens: number; // 已报告的思考用量，与输出用量互斥。
  output_tokens: number; // 已扣除思考用量的模型输出。
}

/** 流水线分别接收批次提交与内容重试，二者可同时存在。 */
export interface TranslationPipelineWorkerResult {
  commit_entries: TranslationCommitEntry[]; // 终态条目或仅用量的批次，提交前核对运行身份。
  retry_contexts: TranslationContext[]; // 保留失败上下文，调度器优先安排重试
}

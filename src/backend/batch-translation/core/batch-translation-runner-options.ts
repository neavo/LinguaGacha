import type { TextTaskItemRecord } from "../../../shared/text/text-types";
import type {
  TranslationContext,
  TranslationCommitEntry,
} from "../planning/translation-plan-types";
import type { LogManager } from "../../log/log-manager";
import type { AppSettingService } from "../../app/app-setting-service";

import type { BatchTranslationRuntime } from "../batch-translation-runtime";
import type { BatchTranslationProjectStore } from "../batch-translation-project-store";
import type { TranslationPlanner } from "../planning/translation-planner";
import type { WorkUnitExecutor } from "../work-unit/work-unit-executor";
import type { WorkUnitLogEntry } from "../protocol/work-unit";

/**
 * BatchTranslationRunner 依赖由 BackendServices 注入，保证后台任务只通过固定端口读写工程事实
 */
export interface BatchTranslationRunnerOptions {
  builtinRoot: string; // 用于任务启动日志读取提示词模板，保持宿主与 worker 内置资产根一致
  taskStore: Pick<
    BatchTranslationProjectStore,
    | "acquire_project_lease"
    | "build_quality_snapshot"
    | "commit_translation_items"
    | "get_translation_items"
    | "get_translation_items_by_scope"
    | "update_translation_progress"
  >; // 任务编排器只依赖项目任务事实的公开能力
  taskRuntime: Pick<
    BatchTranslationRuntime,
    | "change_request_in_flight_count"
    | "is_current"
    | "publish_progress"
    | "publish_status"
    | "read_progress"
  >; // 任务锁、取消、快照和请求压力的最小能力集合
  executorClient: WorkUnitExecutor; // 屏蔽 worker_threads 与直接 runner 的传输差异
  taskPlanner: Pick<
    TranslationPlanner,
    "build_translation_contexts" | "build_translation_retry_plan"
  >; // 精确 token 切块、cache 复用和后台规划的最小能力集合
  AppSettingService: Pick<AppSettingService, "read_setting">; // 每次任务启动只读取设置与模型快照
  logManager: Pick<LogManager, "append" | "info" | "warning" | "error">; // append 承接结构化 worker 日志，其余入口承接普通任务日志
}

/**
 * work-unit executor 返回的翻译类结果
 */
export interface TranslationWorkUnitResult {
  items: TextTaskItemRecord[]; // 只承载本 chunk 最终写回快照，BatchTranslationRunner 决定是否提交
  input_tokens: number; // 请求输入 token，用于任务统计
  reasoning_tokens: number; // 请求思考 token，与输出分开累计
  output_tokens: number; // 请求输出 token，不作为成功与否依据
  stopped: boolean; // 主动取消，区别于失败后可重试
  logs?: WorkUnitLogEntry[]; // 统一回放到 LogManager，worker 不直接写日志
}

/**
 * TranslationPipeline worker 的返回结构，commit 和 retry 明确分离
 */
export interface TranslationPipelineWorkerResult {
  commit_entries: TranslationCommitEntry[]; // 可安全提交的成功结果，提交前仍需核对 run_id
  retry_contexts: TranslationContext[]; // 保留失败上下文，调度器优先安排重试
}

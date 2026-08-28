import type { LogManager } from "../../log/log-manager";
import type { AppSettingService } from "../../app/app-setting-service";
import type { MutableJsonRecord } from "../../../domain/json";
import type { TaskProgressSnapshot as DomainTaskProgressSnapshot } from "../../../domain/task";
import type { TaskRuntime } from "../task-runtime";
import type { TaskProjectStore } from "../task-project-store";
import type { TaskPlanner } from "../planning/task-planner";
import type { WorkUnitExecutor } from "../work-unit/work-unit-executor";
import type { WorkUnitLogEntry } from "../protocol/work-unit";

/**
 * TaskEngine 依赖都从 Gateway 注入，保证后台任务只通过固定端口读写工程事实
 */
export interface TaskEngineOptions {
  appRoot: string; // 用于任务启动日志读取提示词模板，保持 main 与 worker 资源根一致
  taskStore: Pick<
    TaskProjectStore,
    | "acquire_project_lease"
    | "build_quality_snapshot"
    | "commit_analysis_results"
    | "commit_translation_items"
    | "get_analysis_context"
    | "get_translation_items"
    | "get_translation_items_by_scope"
    | "reset_analysis_progress"
    | "update_analysis_progress"
    | "update_translation_progress"
  >; // 任务编排器只依赖项目任务事实的公开能力
  taskRuntime: Pick<
    TaskRuntime,
    | "bind_completion"
    | "change_request_in_flight_count"
    | "finish"
    | "is_current"
    | "publish_progress"
    | "publish_status"
    | "request_stop"
  >; // 任务锁、取消、快照和请求压力的最小能力集合
  executorClient: WorkUnitExecutor; // 屏蔽 worker_threads 与直接 runner 的传输差异
  taskPlanner: Pick<
    TaskPlanner,
    "build_analysis_contexts" | "build_translation_contexts" | "build_translation_retry_plan"
  >; // 精确 token 切块、cache 复用和后台规划的最小能力集合
  AppSettingService: Pick<AppSettingService, "read_setting">; // 每次任务启动只读取设置与模型快照
  logManager: Pick<LogManager, "append" | "info" | "warning" | "error">; // append 承接结构化 worker 日志，其余入口承接普通任务日志
}

/**
 * 翻译和分析共享的进度快照字段，字段名保持公开 task snapshot 兼容
 */
export type TaskProgressSnapshot = DomainTaskProgressSnapshot;

/**
 * work-unit executor 返回的翻译类结果
 */
export interface TranslationWorkUnitResult {
  items: MutableJsonRecord[]; // 只承载本 chunk 最终写回快照，TaskEngine 决定是否提交
  input_tokens: number; // 请求输入 token，用于任务统计
  reasoning_tokens: number; // 请求思考 token，与输出分开累计
  output_tokens: number; // 请求输出 token，不作为成功与否依据
  stopped: boolean; // 主动取消，区别于失败后可重试
  logs?: WorkUnitLogEntry[]; // 统一回放到 LogManager，worker 不直接写日志
}

/**
 * work-unit executor 返回的分析结果
 */
export interface AnalysisWorkUnitResult {
  success: boolean; // 分析结果可进入 checkpoint 提交流程
  stopped: boolean; // 主动取消，不计为分析失败
  input_tokens: number; // 请求输入 token，与翻译共享统计口径
  reasoning_tokens: number; // 请求思考 token，与输出分开累计
  output_tokens: number; // 请求输出 token，与输入量分别累计
  glossary_entries: MutableJsonRecord[]; // 候选快照，去重和 checkpoint 归属由 TaskEngine 处理
  logs?: WorkUnitLogEntry[]; // 只承载结构化诊断文本，不携带数据库对象
}

/**
 * TaskPipeline worker 的返回结构，commit 和 retry 明确分离
 */
export interface TaskPipelineWorkerResult<TContext, TCommit> {
  commit_entries: TCommit[]; // 可安全提交的成功结果，提交前仍需核对 run_id
  retry_contexts: TContext[]; // 保留失败上下文，调度器再按任务类型决定是否重试
}

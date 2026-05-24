import type { MutableJsonRecord, TaskType } from "../runtime/task-runtime-types";
import { TASK_IDLE_STATUSES as BASE_TASK_IDLE_STATUSES } from "../../../shared/task";
import type { LogManager } from "../../log/log-manager";
import type { AppSettingService } from "../../app/app-setting-service";
import type { TaskRuntimePublisher } from "../runtime/task-runtime-publisher";
import type { ProjectTaskStore } from "../store/project-task-store";
import type { TaskPlanner } from "../planning/task-planner";
import type { TaskItemRecord } from "../planning/task-plan-types";
import type { WorkUnitExecutor } from "../work-unit/work-unit-executor";
import type { WorkUnitLogEntry } from "../protocol/work-unit";

// TASK IDLE STATUSES 是领域白名单或配置表，集中维护避免分支散落。
export const TASK_IDLE_STATUSES = new Set<string>(BASE_TASK_IDLE_STATUSES);

/**
 * TaskEngine 依赖都从 Gateway 注入，保证后台任务只通过固定端口读写工程事实
 */
export interface TaskEngineOptions {
  appRoot: string; // appRoot 用于任务启动日志读取提示词模板，保持 main 与 worker 资源根一致
  taskStore: ProjectTaskStore; // taskStore 是任务编排器读写项目任务事实的唯一端口
  taskRuntimePublisher: TaskRuntimePublisher; // taskRuntimePublisher 是完整 task snapshot 的唯一公开出口
  executorClient: WorkUnitExecutor; // executorClient 屏蔽 worker_threads 与直接 runner 的传输差异
  taskPlanner: TaskPlanner; // taskPlanner 是精确 token 切块、cache 复用和后台规划的唯一入口
  AppSettingService: AppSettingService; // AppSettingService 在每次任务启动时提供设置与模型快照
  logManager: LogManager; // logManager 统一收敛任务引擎和 worker 回放日志
}

/**
 * Task Engine 内部运行实例，负责把一次后台任务和取消信号绑定在一起
 */
export interface TaskRunHandle {
  run_id: string; // run_id 是迟到结果隔离键，所有提交前都必须重新核对
  task_type: TaskType; // task_type 决定公开事件 topic payload 里的任务身份
  signal: AbortSignal; // signal 是停止请求向 worker 和 limiter 传播的唯一通道
}

/**
 * 翻译和分析共享的进度快照字段，字段名保持公开 task snapshot 兼容
 */
export interface TaskProgressSnapshot {
  start_time: number; // start_time/time 延续公开快照字段，前端用它们计算耗时而非重新推断
  time: number;
  total_line: number; // total_line 是任务启动时的静态目标，line/processed/error 是运行中累加事实
  line: number;
  processed_line: number;
  error_line: number;
  total_tokens: number; // token 统计由 work unit 汇总，保持总量和输入/输出拆分同时可见
  total_input_tokens: number;
  total_output_tokens: number;
}

/**
 * work-unit executor 返回的翻译类结果
 */
export interface TranslationWorkUnitResult {
  items: TaskItemRecord[]; // items 只承载本 chunk 最终写回快照，TaskEngine 决定是否提交
  row_count: number; // row_count 对齐旧日志口径，表示本 work unit 覆盖行数
  input_tokens: number; // token 字段用于任务统计累加，不作为成功与否的唯一依据
  output_tokens: number;
  stopped: boolean; // stopped 表示主动取消，区别于失败后可重试
  logs?: WorkUnitLogEntry[]; // logs 统一回放到 LogManager，worker 不直接写日志
}

/**
 * work-unit executor 返回的分析结果
 */
export interface AnalysisWorkUnitResult {
  success: boolean; // success 表示分析结果可进入 checkpoint 提交流程
  stopped: boolean; // stopped 表示主动取消，不计为分析失败
  input_tokens: number; // token 字段与翻译共享统计口径
  output_tokens: number;
  glossary_entries: MutableJsonRecord[]; // glossary_entries 是候选快照，去重和 checkpoint 归属由 TaskEngine 处理
  logs?: WorkUnitLogEntry[]; // logs 只承载结构化诊断文本，不携带数据库对象
}

/**
 * TaskPipeline worker 的返回结构，commit 和 retry 明确分离
 */
export interface TaskPipelineWorkerResult<TContext, TCommit> {
  commit_entries: TCommit[]; // commit_entries 是可安全提交的成功结果，提交前仍需核对 run_id
  retry_contexts: TContext[]; // retry_contexts 保留失败上下文，调度器再按任务类型决定是否重试
}

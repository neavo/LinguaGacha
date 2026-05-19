import type { TaskArtifact } from "../protocol/artifact";
import type { StartTaskCommand } from "../protocol/task-command";
import type { TaskType } from "../protocol/task-types";
import type { WorkUnit } from "../protocol/work-unit";
import type { WorkerExecutionResult } from "../protocol/worker-result";
import type { MutableJsonRecord } from "../runtime/task-runtime-types";

export type TaskPlan = {
  task_type: TaskType; // plan 固定归属任务类型，避免跨任务 unit 混入同一轮执行
  progress: MutableJsonRecord; // progress 是 Engine 可累积进度初值，不承载任务差异字段
  units: WorkUnit[]; // units 是 worker execute_unit 的完整输入队列
};

export type WorkerResultInterpretation = {
  retry_units: WorkUnit[]; // retry_units 只包含可安全重试的原 unit 或拆分 unit
  artifacts: TaskArtifact[]; // artifacts 是结果事实，不允许夹带数据库操作
  progress_delta: MutableJsonRecord; // progress_delta 只描述本次 result 对进度的增量
  terminal_error: Error | null; // terminal_error 表示本任务已无法继续，而不是单 unit 失败
};

/**
 * TaskDefinition 承接任务差异，Engine 只负责任务运行、限流、停止和提交循环
 */
export interface TaskDefinition<TCommand extends StartTaskCommand = StartTaskCommand> {
  readonly task_type: TCommand["task_type"];

  /** 规范化命令中的任务私有字段，保证 Engine 收到不可变语义对象 */
  normalize_command(command: TCommand): TCommand;

  /** 声明启动前必须校验的 runtime section revision */
  revision_dependencies(command: TCommand): string[];

  /** 构造任务计划，后续逐步把 Engine 内硬编码切块迁移到 definition */
  prepare_plan(command: TCommand): TaskPlan;

  /** 将计划转换为 worker unit 队列，保持 worker 入口只有 execute_unit */
  build_units(plan: TaskPlan): WorkUnit[];

  /** 解释 worker 结果为重试、artifact、进度增量或终止错误 */
  interpret_worker_result(result: WorkerExecutionResult): WorkerResultInterpretation;

  /** 启动前钩子只允许检查任务私有前置条件，不直接写项目事实 */
  on_before_start?(command: TCommand): void;

  /** 收尾钩子只允许释放任务私有资源，不发布运行态 */
  on_finish?(command: TCommand): void;
}

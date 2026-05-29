import type { TaskRunState } from "../engine/run/task-run-state";
import * as AppErrors from "../../shared/error";

/**
 * ProjectOperationGate 统一协调任务启动与结构性项目 write 的互斥窗口。
 */
export class ProjectOperationGate {
  private readonly task_run_state: TaskRunState; // task_run_state 是后台任务 busy 的唯一运行态事实源

  private exclusive_project_write_running = false; // write lease 覆盖慢准备与提交阶段，避免任务夹入中间态

  /**
   * 注入任务运行态，只读取 busy，不持有项目数据库写入口。
   */
  public constructor(task_run_state: TaskRunState) {
    this.task_run_state = task_run_state;
  }

  /**
   * 执行结构性项目 write；慢准备、revision 校验和提交必须共享同一 lease。
   */
  public async run_exclusive_project_write<T>(operation: () => Promise<T> | T): Promise<T> {
    this.assert_project_write_allowed();
    this.exclusive_project_write_running = true;
    try {
      return await operation();
    } finally {
      this.exclusive_project_write_running = false;
    }
  }

  /**
   * 任务启动在 begin_task 前调用，同时排斥已有任务 busy；调用点不能在校验和 begin_task 之间插入 await。
   */
  public assert_task_start_allowed(): void {
    if (this.exclusive_project_write_running || this.task_run_state.snapshot().busy) {
      throw new AppErrors.TaskBusyError();
    }
  }

  /**
   * write 入口同时排斥后台任务与另一段结构性项目 write。
   */
  private assert_project_write_allowed(): void {
    if (this.exclusive_project_write_running || this.task_run_state.snapshot().busy) {
      throw new AppErrors.TaskBusyError();
    }
  }
}

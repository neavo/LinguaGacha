import * as AppErrors from "../../shared/error";

/**
 * ProjectOperationGate 统一协调任务启动与结构性项目写入的互斥窗口。
 */
export class ProjectOperationGate {
  private readonly read_task_busy: () => boolean; // 只读取后台任务 busy，项目域不依赖任务实现

  private exclusive_project_write_running = false; // 写入租约覆盖慢准备与提交阶段，避免任务夹入中间态

  /**
   * 注入任务 busy 读取函数，不持有任务对象或项目数据库写入口。
   */
  public constructor(read_task_busy: () => boolean) {
    this.read_task_busy = read_task_busy;
  }

  /**
   * 执行结构性项目写入；慢准备、revision 校验和提交必须共享同一 lease。
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
    if (this.exclusive_project_write_running || this.read_task_busy()) {
      throw new AppErrors.TaskBusyError();
    }
  }

  /**
   * 写入口同时排斥后台任务与另一段结构性项目写入。
   */
  private assert_project_write_allowed(): void {
    if (this.exclusive_project_write_running || this.read_task_busy()) {
      throw new AppErrors.TaskBusyError();
    }
  }
}

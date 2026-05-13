import type { TaskRuntimePublisher } from "../runtime/task-runtime-publisher";
import type { TaskType } from "../runtime/task-runtime-types";
import type { TaskRunHandle } from "./engine-options";
import { TaskRunLock } from "./run-lock";

/**
 * RunCoordinator 统一后台任务运行锁、停止请求和终态发布，Engine 主流程只表达业务执行
 */
export class RunCoordinator {
  private readonly run_lock = new TaskRunLock(); // run_lock 是并发互斥和取消信号的底层状态拥有者

  /**
   * runtime_publisher 是任务生命周期状态对外发布的唯一出口
   */
  public constructor(private readonly runtime_publisher: TaskRuntimePublisher) {}

  /**
   * 开始一次任务运行；如果已有任务占用，底层 lock 会在命令边界失败
   */
  public begin(task_type: TaskType): TaskRunHandle {
    return this.run_lock.begin(task_type);
  }

  /**
   * 停止请求先切断 run signal，再同步公开运行态为 stopping
   */
  public async request_stop(task_type: TaskType): Promise<void> {
    if (!this.run_lock.request_stop(task_type)) {
      return;
    }
    await this.runtime_publisher.publish_status(task_type, "stopping", true);
  }

  /**
   * 提交、进度和迟到结果都必须通过 run_id 确认当前性
   */
  public is_current(run_id: string): boolean {
    return this.run_lock.is_current(run_id);
  }

  /**
   * 只允许当前 run 发布终态并释放锁，避免迟到收尾覆盖下一轮任务
   */
  public async finish(handle: TaskRunHandle, status: "idle" | "done" | "error"): Promise<void> {
    if (!this.run_lock.is_current(handle.run_id)) {
      return;
    }
    await this.runtime_publisher.publish_status(handle.task_type, status, false);
    this.run_lock.finish(handle.run_id);
  }
}

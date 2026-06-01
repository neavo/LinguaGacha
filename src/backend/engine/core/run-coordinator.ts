import type { TaskRunPublisher } from "../run/task-run-publisher";
import type { TaskType } from "../run/task-run-types";
import type { TaskRunHandle } from "./engine-options";
import { TaskRunLock } from "./run-lock";

/**
 * RunCoordinator 统一后台任务运行锁、停止请求和终态发布，Engine 主流程只表达业务执行
 */
export class RunCoordinator {
  private readonly run_lock = new TaskRunLock(); // 并发互斥和取消信号的底层状态拥有者

  /**
   * run_publisher 是任务生命周期状态对外发布的唯一出口
   */
  public constructor(private readonly run_publisher: TaskRunPublisher) {}

  /**
   * 开始一次任务运行；如果已有任务占用，底层 lock 会在命令边界失败
   */
  public begin(task_type: TaskType): TaskRunHandle {
    return this.run_lock.begin(task_type);
  }

  /**
   * 停止请求先切断 run signal，再同步公开运行态为 stopping；返回 false 表示未命中当前 run
   */
  public async request_stop(task_type: TaskType): Promise<boolean> {
    if (!this.run_lock.request_stop(task_type)) {
      return false;
    }
    await this.run_publisher.publish_status(task_type, "stopping", true);
    return true;
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
    await this.run_publisher.publish_status(handle.task_type, status, false);
    this.run_lock.finish(handle.run_id);
  }
}

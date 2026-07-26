import crypto from "node:crypto";

import type { TaskRunPublisher } from "../run/task-run-publisher";
import type { TaskType } from "../run/task-run-types";
import type { TaskRunHandle } from "./engine-options";
import * as AppErrors from "../../../shared/error";

interface ActiveRun {
  run_id: string; // 当前任务的唯一身份，异步收尾必须凭它判断是否仍然有效
  task_type: TaskType; // 用于拒绝错误类型的 stop 请求
  abort_controller: AbortController; // 停止请求向所有等待点传播的唯一对象
}

/**
 * RunCoordinator 统一后台任务运行锁、停止请求和终态发布，Engine 主流程只表达业务执行
 */
export class RunCoordinator {
  private active_run: ActiveRun | null = null; // 全局运行互斥的唯一内存事实

  /**
   * run_publisher 是任务生命周期状态对外发布的唯一出口
   */
  public constructor(private readonly run_publisher: TaskRunPublisher) {}

  /**
   * 开始一次任务运行；如果已有任务占用，就在命令边界失败
   */
  public begin(task_type: TaskType): TaskRunHandle {
    if (this.active_run !== null) {
      throw new AppErrors.TaskBusyError();
    }
    const abort_controller = new AbortController();
    const run_id = crypto.randomUUID();
    this.active_run = { run_id, task_type, abort_controller };
    return { run_id, task_type, signal: abort_controller.signal };
  }

  /**
   * 停止请求先切断 run signal，再同步公开运行态为 stopping；返回 false 表示未命中当前 run
   */
  public async request_stop(task_type: TaskType): Promise<boolean> {
    if (this.active_run === null || this.active_run.task_type !== task_type) {
      return false;
    }
    this.active_run.abort_controller.abort();
    await this.run_publisher.publish_status(task_type, "stopping", true);
    return true;
  }

  /**
   * 提交、进度和迟到结果都必须通过 run_id 确认当前性
   */
  public is_current(run_id: string): boolean {
    return this.active_run?.run_id === run_id;
  }

  /**
   * 只允许当前 run 发布终态并释放锁，避免迟到收尾覆盖下一轮任务
   */
  public async finish(handle: TaskRunHandle, status: "idle" | "done" | "error"): Promise<void> {
    if (!this.is_current(handle.run_id)) {
      return;
    }
    await this.run_publisher.publish_status(handle.task_type, status, false);
    this.active_run = null;
  }
}

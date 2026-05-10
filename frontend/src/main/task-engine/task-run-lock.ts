import crypto from "node:crypto";

import type { TaskType } from "../task/task-types";
import type { TaskRunHandle } from "./task-engine-types";

interface ActiveRun {
  // run_id 是当前任务的唯一身份，异步收尾必须凭它判断是否仍然有效。
  run_id: string;
  // task_type 用于拒绝错误类型的 stop 请求。
  task_type: TaskType;
  // abort_controller 是停止请求向所有等待点传播的唯一对象。
  abort_controller: AbortController;
}

/**
 * 后台任务全局互斥锁，同一时间只允许一个任务流占用 Task Engine。
 */
export class TaskRunLock {
  private active_run: ActiveRun | null = null;

  /**
   * 开始一个任务运行；如果已有后台任务占用，就在公开命令边界失败。
   */
  public begin(task_type: TaskType): TaskRunHandle {
    if (this.active_run !== null) {
      throw new Error("已有后台任务正在运行。");
    }
    const abort_controller = new AbortController();
    const run_id = crypto.randomUUID();
    this.active_run = { run_id, task_type, abort_controller };
    return { run_id, task_type, signal: abort_controller.signal };
  }

  /**
   * 请求停止当前任务；停止只切断后续 work unit，已发请求由超时兜底。
   */
  public request_stop(task_type: TaskType): boolean {
    if (this.active_run === null || this.active_run.task_type !== task_type) {
      return false;
    }
    this.active_run.abort_controller.abort();
    return true;
  }

  /**
   * 判断异步结果是否仍属于当前 run，防止迟到返回写入下一轮任务。
   */
  public is_current(run_id: string): boolean {
    return this.active_run?.run_id === run_id;
  }

  /**
   * 释放当前任务；非当前 run 的迟到收尾不能清掉新任务锁。
   */
  public finish(run_id: string): void {
    if (this.active_run?.run_id === run_id) {
      this.active_run = null;
    }
  }
}

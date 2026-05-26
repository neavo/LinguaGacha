import {
  ProjectUiWorkerClientError,
  type ProjectUiWorkerClientErrorCode,
} from "@/project/worker/project-ui-worker-errors";
import type {
  ProjectUiWorkerRequestPayload,
  ProjectUiWorkerResponse,
} from "@/project/worker/project-ui-worker-protocol";
import type { ErrorDiagnosticPayload } from "@shared/error";

export type ProjectUiWorkerPriority = "foreground" | "normal" | "background" | "disposable";

export type ProjectUiWorkerSubmitOptions = {
  priority?: ProjectUiWorkerPriority;
  staleKey?: string | null;
};

type PendingProjectUiWorkerTask<TResult> = {
  id: number; // id 是 worker 协议回包匹配键
  sequence: number; // sequence 保证同优先级任务按提交顺序派发
  priority: ProjectUiWorkerPriority; // priority 决定排队任务的前台/后台响应顺序
  stale_key: string | null; // stale_key 标记同类可覆盖请求，null 表示永不过期
  generation: number; // generation 是 stale_key 下的版本号，用来识别旧请求
  request: ProjectUiWorkerRequestPayload; // request 是去掉 id 后的窄化协议载荷
  resolve: (result: TResult) => void; // resolve 只在当前请求未过期且 worker 成功返回时触发
  reject: (error: Error) => void; // reject 统一输出 ProjectUiWorkerClientError
};

// 优先级数值越高越先派发；disposable 只用于可被用户路径挤开的低价值任务。
const PROJECT_UI_WORKER_PRIORITY_RANK: Readonly<Record<ProjectUiWorkerPriority, number>> = {
  foreground: 3,
  normal: 2,
  background: 1,
  disposable: 0,
};

/**
 * 创建稳定的 worker 边界错误，调用点只暴露 code，不分叉错误文案。
 */
function create_project_ui_worker_error(
  code: ProjectUiWorkerClientErrorCode,
  diagnostic?: ErrorDiagnosticPayload,
): Error {
  return new ProjectUiWorkerClientError(code, diagnostic);
}

// ProjectUiWorkerScheduler 收口当前模块的状态和副作用边界，避免调用方分散维护同一流程。
export class ProjectUiWorkerScheduler {
  private readonly create_worker: () => Worker; // create_worker 是唯一创建浏览器 Worker 的入口，测试可注入替身

  private readonly queue: Array<PendingProjectUiWorkerTask<unknown>> = []; // queue 保存尚未派发的请求，按优先级和提交顺序消费

  private readonly latest_generation_by_stale_key = new Map<string, number>(); // stale generation 让同 key 旧请求在派发前或返回后失效

  private worker: Worker | null = null; // worker 延迟创建，避免打开项目前占用后台资源

  private in_flight: PendingProjectUiWorkerTask<unknown> | null = null; // 单 worker 同一时间只派发一个任务，避免隐式并发冲掉优先级语义

  private next_request_id = 0; // 单调 id 只在当前 renderer 生命周期内用于请求/响应配对

  private next_sequence = 0; // 单调 sequence 只服务调度公平性，不进入 worker 协议

  private disposed = false; // disposed 后所有新请求立即失败，避免复活已终止 worker

  /**
   * 调度器只管理 renderer 项目 UI 后台任务，不持有 ProjectStore 或页面状态。
   */
  public constructor(create_worker: () => Worker = create_default_project_ui_worker) {
    this.create_worker = create_worker;
  }

  /**
   * 提交一项后台请求；staleKey 相同的新请求会覆盖旧请求的可见结果。
   */
  public submit<TResult>(
    request: ProjectUiWorkerRequestPayload,
    options: ProjectUiWorkerSubmitOptions = {},
  ): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(create_project_ui_worker_error("disposed"));
    }

    this.next_request_id += 1;
    this.next_sequence += 1;
    const stale_key = options.staleKey ?? null;
    const generation =
      stale_key === null ? 0 : (this.latest_generation_by_stale_key.get(stale_key) ?? 0) + 1;
    if (stale_key !== null) {
      this.latest_generation_by_stale_key.set(stale_key, generation);
    }

    return new Promise<TResult>((resolve, reject) => {
      this.queue.push({
        id: this.next_request_id,
        sequence: this.next_sequence,
        priority: options.priority ?? "normal",
        stale_key,
        generation,
        request,
        resolve: (result) => resolve(result as TResult),
        reject,
      });
      this.dispatch_next();
    });
  }

  /**
   * 让同类可覆盖任务立即过期；释放缓存时需要取消 hydrate，但释放请求本身必须执行。
   */
  public invalidate_stale_key(staleKey: string): void {
    const generation = (this.latest_generation_by_stale_key.get(staleKey) ?? 0) + 1;
    this.latest_generation_by_stale_key.set(staleKey, generation);
  }

  /**
   * 释放 worker 和全部待处理请求；只在测试或 renderer 生命周期结束时调用。
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.reject_all(create_project_ui_worker_error("disposed"));
    this.worker?.terminate();
    this.worker = null;
  }

  /**
   * 确保底层 worker 存在，并把所有通道错误归一成 Project UI Worker 错误。
   */
  private ensure_worker(): Worker {
    if (this.worker !== null) {
      return this.worker;
    }

    if (typeof Worker === "undefined") {
      throw create_project_ui_worker_error("unsupported");
    }

    try {
      this.worker = this.create_worker();
    } catch {
      this.worker = null;
      throw create_project_ui_worker_error("init_failed");
    }

    this.worker.addEventListener("message", (event: MessageEvent<ProjectUiWorkerResponse>) => {
      this.handle_worker_message(event.data);
    });
    this.worker.addEventListener("error", () => {
      this.handle_worker_error();
    });
    return this.worker;
  }

  /**
   * 消费下一个可运行请求；旧 generation 的排队请求会在这里直接失败。
   */
  private dispatch_next(): void {
    if (this.disposed || this.in_flight !== null) {
      return;
    }

    const task = this.take_next_task();
    if (task === null) {
      return;
    }

    let worker: Worker;
    try {
      worker = this.ensure_worker();
    } catch (error) {
      task.reject(error instanceof Error ? error : create_project_ui_worker_error("init_failed"));
      this.reject_all(create_project_ui_worker_error("init_failed"));
      return;
    }

    this.in_flight = task;
    try {
      worker.postMessage({
        id: task.id,
        ...task.request,
      });
    } catch {
      this.in_flight = null;
      task.reject(create_project_ui_worker_error("execution_failed"));
      this.dispatch_next();
    }
  }

  /**
   * 按优先级取任务；同优先级保持 FIFO，避免后台刷新饿死。
   */
  private take_next_task(): PendingProjectUiWorkerTask<unknown> | null {
    for (;;) {
      let best_index = -1;
      let best_task: PendingProjectUiWorkerTask<unknown> | null = null;
      for (let index = 0; index < this.queue.length; index += 1) {
        const task = this.queue[index];
        if (task === undefined) {
          continue;
        }
        if (this.is_task_stale(task)) {
          this.queue.splice(index, 1);
          task.reject(create_project_ui_worker_error("stale"));
          best_index = -1;
          best_task = null;
          break;
        }
        if (
          best_task === null ||
          PROJECT_UI_WORKER_PRIORITY_RANK[task.priority] >
            PROJECT_UI_WORKER_PRIORITY_RANK[best_task.priority] ||
          (PROJECT_UI_WORKER_PRIORITY_RANK[task.priority] ===
            PROJECT_UI_WORKER_PRIORITY_RANK[best_task.priority] &&
            task.sequence < best_task.sequence)
        ) {
          best_index = index;
          best_task = task;
        }
      }

      if (best_task === null || best_index < 0) {
        if (this.queue.length === 0) {
          return null;
        }
        continue;
      }

      this.queue.splice(best_index, 1);
      return best_task;
    }
  }

  /**
   * worker 返回结果时只完成当前 in-flight 请求，迟到或未知 id 直接忽略。
   */
  private handle_worker_message(message: ProjectUiWorkerResponse): void {
    const task = this.in_flight;
    if (task === null || task.id !== message.id) {
      return;
    }

    this.in_flight = null;
    if (this.is_task_stale(task)) {
      task.reject(create_project_ui_worker_error("stale"));
    } else if (message.ok) {
      task.resolve(message.result);
    } else {
      task.reject(create_project_ui_worker_error("execution_failed", message.error_diagnostic));
    }
    this.dispatch_next();
  }

  /**
   * worker 通道失败只拒绝当前任务并重建通道，队列里的后续请求继续尝试。
   */
  private handle_worker_error(): void {
    const task = this.in_flight;
    this.in_flight = null;
    task?.reject(create_project_ui_worker_error("execution_failed"));
    this.worker?.terminate();
    this.worker = null;
    this.dispatch_next();
  }

  /**
   * 判断任务是否已经被同 staleKey 的更新请求替代；派发前和返回后都要检查。
   */
  private is_task_stale(task: PendingProjectUiWorkerTask<unknown>): boolean {
    return (
      task.stale_key !== null &&
      this.latest_generation_by_stale_key.get(task.stale_key) !== task.generation
    );
  }

  /**
   * 用同一个错误拒绝当前任务和队列，确保 dispose 或初始化失败时没有悬空 Promise。
   */
  private reject_all(error: Error): void {
    this.in_flight?.reject(error);
    this.in_flight = null;
    while (this.queue.length > 0) {
      this.queue.shift()?.reject(error);
    }
  }
}

/**
 * 默认 worker 入口固定在 project-ui-worker-entry，调度器本身不感知具体业务实现。
 */
function create_default_project_ui_worker(): Worker {
  return new Worker(new URL("./project-ui-worker-entry.ts", import.meta.url), {
    type: "module",
  });
}

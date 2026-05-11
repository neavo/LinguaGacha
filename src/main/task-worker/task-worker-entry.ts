import { parentPort, workerData } from "node:worker_threads";

import type { ApiJsonValue } from "../api/api-types";
import { WorkUnitRunner, type WorkUnitRunnerOptions } from "./work-unit/work-unit-runner";

// run 消息是主线程派发 work unit 的唯一入口，body 保持 JSON 形状。
interface WorkerRequestMessage {
  id: string;
  type: "run";
  method: string;
  body: Record<string, ApiJsonValue>;
}

// cancel 消息只携带任务 id，实际中断通过对应 AbortController 传递。
interface WorkerCancelMessage {
  id: string;
  type: "cancel";
}

// worker 入口只理解 run/cancel 两种协议，避免任务语义渗进消息层。
type WorkerIncomingMessage = WorkerRequestMessage | WorkerCancelMessage;

/**
 * worker_threads 入口，只处理消息、取消和结果回传，不承载业务逻辑。
 */
class TaskWorkerEntry {
  private readonly runner: WorkUnitRunner;
  // controllers 按消息 id 保存，允许主线程只取消指定 work unit。
  private readonly controllers = new Map<string, AbortController>();

  /**
   * workerData 由 TaskWorkerPool 注入，只包含 work unit 需要的资源根。
   */
  public constructor(options: WorkUnitRunnerOptions) {
    this.runner = new WorkUnitRunner(options);
  }

  /**
   * 收到 run 执行 work unit，收到 cancel 只中断对应 AbortController。
   */
  public handle_message(message: WorkerIncomingMessage): void {
    if (message.type === "cancel") {
      this.controllers.get(message.id)?.abort();
      return;
    }
    void this.run_message(message);
  }

  /**
   * 每条消息独立 AbortController，迟到结果由 TaskEngine 的 run_id 再隔离。
   */
  private async run_message(message: WorkerRequestMessage): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(message.id, controller);
    try {
      const data = await this.runner.run(message.method, message.body, controller.signal);
      parentPort?.postMessage({ id: message.id, ok: true, data });
    } catch (error) {
      parentPort?.postMessage({
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.controllers.delete(message.id);
    }
  }
}

// 顶层入口必须立即绑定 parentPort，worker_threads 加载后即可接收池派发消息。
const entry = new TaskWorkerEntry(workerData as WorkUnitRunnerOptions);
parentPort?.on("message", (message: WorkerIncomingMessage) => entry.handle_message(message));

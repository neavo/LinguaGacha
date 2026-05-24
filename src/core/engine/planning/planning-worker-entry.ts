import { parentPort } from "node:worker_threads";

import { create_o200k_base_token_counter } from "../core/token-counter";
import type {
  PlanningCancelMessage,
  PlanningCountTokensMessage,
  PlanningWorkerIncomingMessage,
} from "./planning-worker-types";
import { to_error_diagnostic } from "../../../shared/error";
import type { TaskTokenCountResult } from "./token-metric-cache";

const YIELD_EVERY_ITEMS = 256; // 大批量计数定期让出事件循环，使 cancel 消息能被处理。

/**
 * planning worker 只负责 CPU 密集 token 计数，不读取数据库、不发布事件、不持久化结果。
 */
class PlanningWorkerEntry {
  private readonly token_counter = create_o200k_base_token_counter(); // 每个 worker 独占 tokenizer，避免跨线程共享不可序列化对象。
  private readonly cancelled_ids = new Set<string>(); // cancelled_ids 记录已收到取消但尚未结束的消息 id。

  /**
   * 消息入口只分发 count 与 cancel，业务规划语义留在主线程 TaskPlanner。
   */
  public handle_message(message: PlanningWorkerIncomingMessage): void {
    if (message.type === "cancel") {
      this.handle_cancel(message);
      return;
    }
    void this.handle_count_tokens(message);
  }

  /**
   * 取消标记由计数循环定期读取，避免强行终止 worker 造成 tokenizer 资源反复初始化。
   */
  private handle_cancel(message: PlanningCancelMessage): void {
    this.cancelled_ids.add(message.id);
  }

  /**
   * 逐条精确计数并回传结果；worker 不理解 item 状态和 chunk 切分。
   */
  private async handle_count_tokens(message: PlanningCountTokensMessage): Promise<void> {
    try {
      const data = await this.count_tokens(message);
      parentPort?.postMessage({ id: message.id, ok: true, data });
    } catch (error) {
      parentPort?.postMessage({
        id: message.id,
        ok: false,
        error_diagnostic: to_error_diagnostic(error, { worker_message_type: message.type }),
      });
    } finally {
      this.cancelled_ids.delete(message.id);
    }
  }

  /**
   * 大批量计数每隔固定行数让出事件循环，保证后台规划可被停止请求打断。
   */
  private async count_tokens(message: PlanningCountTokensMessage): Promise<TaskTokenCountResult[]> {
    const results: TaskTokenCountResult[] = [];
    for (const [index, item] of message.items.entries()) {
      if (this.cancelled_ids.has(message.id)) {
        throw new Error("规划 token 计数已取消。");
      }
      results.push({
        cache_key: item.cache_key,
        token_count: this.token_counter.count(item.text),
      });
      if (index > 0 && index % YIELD_EVERY_ITEMS === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    return results;
  }
}

const entry = new PlanningWorkerEntry(); // 顶层入口必须立即绑定 parentPort，worker_threads 加载后即可接收池派发消息。
parentPort?.on("message", (message: PlanningWorkerIncomingMessage) =>
  entry.handle_message(message),
);

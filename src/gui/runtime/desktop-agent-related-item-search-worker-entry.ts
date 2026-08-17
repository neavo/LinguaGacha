import { parentPort } from "node:worker_threads";

import type {
  RelatedItemSearchWorkerIncomingMessage,
  RelatedItemSearchWorkerOutgoingMessage,
} from "./desktop-agent-related-item-search";
import { run_related_item_search } from "./desktop-agent-related-item-search-worker";

if (parentPort === null) throw new Error("Related item search worker requires parentPort.");

// 单 worker 串行访问同一个 sidecar；取消集合让排队和构建中的请求使用同一信号。
const cancelled = new Set<string>();
let queue = Promise.resolve();

parentPort.on("message", (message: RelatedItemSearchWorkerIncomingMessage) => {
  if (message.type === "cancel") {
    cancelled.add(message.id);
    return;
  }
  queue = queue.then(async () => {
    try {
      const result = await run_related_item_search(message.input, () => cancelled.has(message.id));
      post({ id: message.id, ok: true, result });
    } catch (error) {
      post({
        id: message.id,
        ok: false,
        message: error instanceof Error ? error.message : "Related item search failed.",
      });
    } finally {
      cancelled.delete(message.id);
    }
  });
});

/** parentPort 已在模块入口验证，函数只收口跨线程消息类型。 */
function post(message: RelatedItemSearchWorkerOutgoingMessage): void {
  parentPort?.postMessage(message);
}

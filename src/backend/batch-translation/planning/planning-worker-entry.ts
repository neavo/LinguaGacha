import { parentPort } from "node:worker_threads";

import { count_token_batch } from "./token-counter";
import type {
  PlanningWorkerIncomingMessage,
  PlanningWorkerOutgoingMessage,
} from "./planning-worker-types";
import { to_log_error } from "../../../shared/error";

// 池等待本批终态后才派发下一批，因此 worker 只拥有一个活动取消源。
let active: { id: number; controller: AbortController } | null = null;

/** 将一次计数转换为线程终态，回包前释放活动取消源。 */
async function count_batch(
  message: Extract<PlanningWorkerIncomingMessage, { type: "count_tokens" }>,
): Promise<void> {
  const controller = new AbortController();
  active = { id: message.id, controller };
  let result: PlanningWorkerOutgoingMessage;
  try {
    const counts = await count_token_batch(message.texts, controller.signal);
    result = { id: message.id, status: "done", counts };
  } catch (error) {
    result = controller.signal.aborted
      ? { id: message.id, status: "cancelled" }
      : {
          id: message.id,
          status: "error",
          error: to_log_error(error, { worker_message_type: message.type }),
        };
  }
  active = null;
  parentPort?.postMessage(result);
}

parentPort?.on("message", (message: PlanningWorkerIncomingMessage) => {
  if (message.type === "cancel") {
    if (active?.id === message.id) active.controller.abort();
  } else {
    void count_batch(message);
  }
});

import { parentPort } from "node:worker_threads";

import { to_log_error } from "../../../shared/error";
import { ProofreadingQueryWorkerCache } from "./proofreading-query-worker-cache";
import type {
  ProofreadingQueryWorkerIncomingMessage,
  ProofreadingQueryWorkerOutgoingMessage,
} from "./proofreading-query-worker-protocol";

const cancelled_ids = new Set<string>(); // 取消只影响对应消息，worker 进程仍由主线程门面管理。
const cache = new ProofreadingQueryWorkerCache();

function handle_message(message: ProofreadingQueryWorkerIncomingMessage): void {
  if (message.type === "cancel") {
    cancelled_ids.add(message.id);
    return;
  }
  void execute_message(message);
}

async function execute_message(
  message: Exclude<ProofreadingQueryWorkerIncomingMessage, { type: "cancel" }>,
): Promise<void> {
  try {
    assert_not_cancelled(message.id);
    const data = execute_task(message);
    post_message({ id: message.id, ok: true, data });
  } catch (error) {
    post_message({
      id: message.id,
      ok: false,
      error: to_log_error(error, { worker_message_type: message.type }),
    });
  } finally {
    cancelled_ids.delete(message.id);
  }
}

function execute_task(
  message: Exclude<ProofreadingQueryWorkerIncomingMessage, { type: "cancel" }>,
) {
  if (message.type === "proofreading.sync") {
    return cache.sync(message.key, message.input);
  }
  if (message.type === "proofreading.query") {
    return cache.query(message.key, message.input);
  }
  cache.dispose(message.input);
  return {};
}

function assert_not_cancelled(id: string): void {
  if (cancelled_ids.has(id)) {
    throw new Error("校对 query worker 计算已取消。");
  }
}

function post_message(message: ProofreadingQueryWorkerOutgoingMessage): void {
  parentPort?.postMessage(message);
}

parentPort?.on("message", (message: ProofreadingQueryWorkerIncomingMessage) => {
  handle_message(message);
});

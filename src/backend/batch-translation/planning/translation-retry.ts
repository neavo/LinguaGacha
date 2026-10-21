import crypto from "node:crypto";
import type { TextTaskItemRecord } from "../../../shared/text/text-processing";
import { read_task_item_id, read_task_item_status } from "../translation-item";
import type { TranslationContext } from "./translation-plan-types";

// 质量控制已转到 AGENT 流程，批量翻译只做有限收敛：多条先对半切，再逐条执行。
const TRANSLATION_HALVING_ROUNDS = 2; // 多条单元对半切的轮数。
const TRANSLATION_SINGLE_RETRY_LIMIT = 1; // 单条单元首次执行后的重试次数。

/** 按单元粒度收敛失败条目，单条耗尽预算后在 worker 快照上标记 ERROR。 */
export function plan_translation_retry(
  context: TranslationContext,
  returned_items: TextTaskItemRecord[],
): { retry_contexts: TranslationContext[]; error_items: TextTaskItemRecord[] } {
  const pending_by_id = new Map(
    returned_items
      .filter((item) => read_task_item_status(item) === "NONE")
      .map((item) => [read_task_item_id(item), item]),
  );
  const is_single = context.items.length === 1;
  if (is_single && context.retry_count >= TRANSLATION_SINGLE_RETRY_LIMIT) {
    // 终态提交保留 worker 写回的译文和附加字段。
    const error_items = [...pending_by_id.values()];
    for (const item of error_items) item["status"] = "ERROR";
    return { retry_contexts: [], error_items };
  }
  // worker 决定待重试集合，拆块使用本轮原始源文与顺序。
  const pending_items = context.items.filter((item) => pending_by_id.has(read_task_item_id(item)));
  const chunk_size =
    context.retry_count < TRANSLATION_HALVING_ROUNDS ? Math.ceil(pending_items.length / 2) : 1;
  const retry_contexts: TranslationContext[] = [];
  for (let index = 0; index < pending_items.length; index += chunk_size) {
    const items = pending_items.slice(index, index + chunk_size);
    retry_contexts.push({
      work_unit_id: crypto.randomUUID(),
      items,
      precedings: [],
      followings: [],
      retry_count: !is_single && items.length === 1 ? 0 : context.retry_count + 1, // 多条拆成单条时开始单条计数。
    });
  }
  return { retry_contexts, error_items: [] };
}

type ContextItem = { item_id: number; file_path: string; src: string };
type PendingContext = { target_item_id: number; item_ids: number[]; remaining: number };
const CONTEXT_NEIGHBORS = 2; // 同文件前后各两条非空原文

/**
 * 查询目标条目的同文件邻近语境，单次扫描合并共享证据。
 * @param items 条目数组或异步流。将同一文件的条目连续排列，文件内按自然顺序排列。每项至少包含 `item_id`、`file_path` 和 `src`。
 * @param item_ids 本次目标 ID，返回上下文与缺失目标沿用请求顺序。
 * @returns 返回以下字段：
 * - `contexts`：每项用 `target_item_id` 关联 `item_ids`，包含目标自身及同文件前后各两条非空原文。
 * - `items`：上述语境涉及的完整条目，按首次出现顺序排列，并按 `item_id` 去重。
 * - `missing_item_ids`：输入流中未找到的目标。
 * 调用方负责读取输入条目。返回结果引用原条目，调用方应按只读数据使用。
 */
export async function queryItemContexts<Item extends ContextItem>(
  items: AsyncIterable<Item> | Iterable<Item>,
  item_ids: readonly number[],
): Promise<{
  contexts: { target_item_id: number; item_ids: number[] }[];
  items: Item[];
  missing_item_ids: number[];
}> {
  const targetIds = new Set(item_ids);
  const contextsById = new Map<number, PendingContext>();
  const returnedItemById = new Map<number, Item>(); // Map 更新已有键保留首次插入顺序，邻近目标可共享证据。
  let currentFilePath: string | null = null;
  let beforeItems: Item[] = [];
  // 尚未收满后文的目标共享单次顺序扫描，不为每个 item 重读完整数据集。
  let pendingContexts: PendingContext[] = [];

  for await (const item of items) {
    if (item.file_path !== currentFilePath) {
      currentFilePath = item.file_path;
      beforeItems = [];
      pendingContexts = [];
    }

    if (item.src.trim() !== "") {
      for (const pending of pendingContexts) {
        pending.item_ids.push(item.item_id);
        pending.remaining -= 1;
        returnedItemById.set(item.item_id, item);
      }
      pendingContexts = pendingContexts.filter((pending) => pending.remaining > 0);
    }

    const item_id = item.item_id;
    if (targetIds.has(item_id)) {
      const context = {
        target_item_id: item_id,
        item_ids: [...beforeItems.map((entry) => entry.item_id), item_id],
        remaining: CONTEXT_NEIGHBORS,
      };
      contextsById.set(item_id, context);
      for (const before of beforeItems) returnedItemById.set(before.item_id, before);
      returnedItemById.set(item_id, item);
      pendingContexts.push(context);
    }

    if (item.src.trim() !== "") {
      beforeItems.push(item);
      if (beforeItems.length > CONTEXT_NEIGHBORS) beforeItems.shift();
    }
  }

  const contexts = item_ids.flatMap((itemId) => {
    const context = contextsById.get(itemId);
    return context === undefined
      ? []
      : [{ target_item_id: context.target_item_id, item_ids: context.item_ids }];
  });
  return {
    contexts,
    items: [...returnedItemById.values()],
    missing_item_ids: item_ids.filter((itemId) => !contextsById.has(itemId)),
  };
}

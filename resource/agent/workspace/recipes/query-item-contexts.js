// 固定读取目标在同文件自然顺序中的前后各两条非空原文，保持与产品上下文口径一致。
const contract = await workspace.readJson("contract.json");
const targetIds = new Set(args.item_ids);
const contextsById = new Map();
const returnedItemById = new Map();
const returnedItemOrder = [];
let currentFilePath = null;
let beforeItems = [];
// 尚未收满后文的目标共享单次顺序扫描，不为每个 item 重读完整数据集。
let pendingContexts = [];

// 多个相邻目标会共享证据条目，输出只保留第一次出现的自然顺序。
const includeItem = (item) => {
  if (returnedItemById.has(item.item_id)) return;
  returnedItemById.set(item.item_id, item);
  returnedItemOrder.push(item.item_id);
};

for await (const item of workspace.readJsonl(contract.datasets.items.path)) {
  if (item.file_path !== currentFilePath) {
    currentFilePath = item.file_path;
    beforeItems = [];
    pendingContexts = [];
  }

  if (item.src.trim() !== "") {
    for (const pending of pendingContexts) {
      pending.item_ids.push(item.item_id);
      pending.remaining -= 1;
      includeItem(item);
    }
    pendingContexts = pendingContexts.filter((pending) => pending.remaining > 0);
  }

  if (targetIds.has(item.item_id)) {
    const context = {
      target_item_id: item.item_id,
      item_ids: [...beforeItems.map((entry) => entry.item_id), item.item_id],
      remaining: 2,
    };
    contextsById.set(item.item_id, context);
    for (const before of beforeItems) includeItem(before);
    includeItem(item);
    pendingContexts.push(context);
  }

  if (item.src.trim() !== "") {
    beforeItems.push(item);
    if (beforeItems.length > 2) beforeItems.shift();
  }
}

const contexts = args.item_ids.flatMap((itemId) => {
  const context = contextsById.get(itemId);
  return context === undefined
    ? []
    : [{ target_item_id: context.target_item_id, item_ids: context.item_ids }];
});
return {
  contexts,
  items: returnedItemOrder.map((itemId) => returnedItemById.get(itemId)),
  missing_item_ids: args.item_ids.filter((itemId) => !contextsById.has(itemId)),
};

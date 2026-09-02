import { Type } from "@earendil-works/pi-ai";

import type { AgentWorkspaceItem } from "../workspace/schema";
import { AGENT_WORKSPACE_ITEM_SCHEMA } from "../workspace/schema";
import { define_agent_workspace_method } from "./method";

type PendingContext = {
  target_item_id: number;
  item_ids: number[];
  remaining: number;
};

const parameters = Type.Object(
  { item_ids: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }) },
  { additionalProperties: false },
);

const result = Type.Object(
  {
    contexts: Type.Array(
      Type.Object(
        {
          target_item_id: Type.Integer({ minimum: 1 }),
          item_ids: Type.Array(Type.Integer({ minimum: 1 })),
        },
        { additionalProperties: false },
      ),
    ),
    items: Type.Array(AGENT_WORKSPACE_ITEM_SCHEMA),
    missing_item_ids: Type.Array(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

/** 固定读取目标在同文件自然顺序中的前后各两条非空原文。 */
export const queryItemContexts = define_agent_workspace_method({
  useWhen: "读取目标 item 的规范邻近上下文",
  description: "为目标 item 读取同文件自然顺序中前后各两条非空原文。",
  parameters,
  result,
  async execute(context, args) {
    const item_ids = args.item_ids;
    const targetIds = new Set(item_ids);
    const contextsById = new Map<number, PendingContext>();
    const returnedItemById = new Map<number, AgentWorkspaceItem>();
    let currentFilePath: string | null = null;
    let beforeItems: AgentWorkspaceItem[] = [];
    // 尚未收满后文的目标共享单次顺序扫描，不为每个 item 重读完整数据集。
    let pendingContexts: PendingContext[] = [];

    // 多个相邻目标会共享证据条目，输出只保留第一次出现的自然顺序。
    const includeItem = (item: AgentWorkspaceItem): void => {
      const item_id = item.item_id;
      if (returnedItemById.has(item_id)) return;
      returnedItemById.set(item_id, item);
    };

    for await (const item of context.data.items()) {
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

      const item_id = item.item_id;
      if (targetIds.has(item_id)) {
        const context = {
          target_item_id: item_id,
          item_ids: [...beforeItems.map((entry) => entry.item_id), item_id],
          remaining: 2,
        };
        contextsById.set(item_id, context);
        for (const before of beforeItems) includeItem(before);
        includeItem(item);
        pendingContexts.push(context);
      }

      if (item.src.trim() !== "") {
        beforeItems.push(item);
        if (beforeItems.length > 2) beforeItems.shift();
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
  },
});

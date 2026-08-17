import { describe, expect, it } from "vitest";

import { read_json_record, type JsonRecord } from "../../domain/json";
import {
  execute_workspace_method,
  workspace_item,
  WORKSPACE_QUERY_PAGE_MAX,
} from "../../test/agent-workspace-method-support";

describe("workspace.queryItemContexts 发布方法", () => {
  it("保留具名关系并合并重复证据对象", async () => {
    const result = read_json_record(
      await execute_workspace_method(
        "query-item-contexts",
        { item_ids: [12, 14, 999] },
        {
          "items/entries.jsonl": [
            workspace_item(1, { src: "前文件", file_path: "before.txt" }),
            workspace_item(9, { src: "原文 9", file_path: "script.txt" }),
            workspace_item(10, { src: "  ", file_path: "script.txt" }),
            workspace_item(11, { src: "原文 11", file_path: "script.txt" }),
            workspace_item(12, { src: "原文 12", file_path: "script.txt" }),
            workspace_item(13, { src: "\t　", file_path: "script.txt" }),
            workspace_item(14, { src: "原文 14", file_path: "script.txt" }),
            workspace_item(15, { src: "原文 15", file_path: "script.txt" }),
            workspace_item(20, { src: "后文件", file_path: "after.txt" }),
          ],
        },
      ),
    );

    expect(result).toMatchObject({
      contexts: [
        { target_item_id: 12, item_ids: [9, 11, 12, 14, 15] },
        { target_item_id: 14, item_ids: [11, 12, 14, 15] },
      ],
      missing_item_ids: [999],
    });
    expect((result["items"] as JsonRecord[]).map((entry) => entry["item_id"])).toEqual([
      9, 11, 12, 14, 15,
    ]);
  });

  it("完整处理显式目标，不套用发现查询的分页上限", async () => {
    const item_ids = Array.from({ length: WORKSPACE_QUERY_PAGE_MAX + 1 }, (_, index) => index + 1);

    await expect(
      execute_workspace_method("query-item-contexts", { item_ids }, { "items/entries.jsonl": [] }),
    ).resolves.toEqual({ contexts: [], items: [], missing_item_ids: item_ids });
  });
});

import { describe, expect, it } from "vitest";
import { queryItemContexts } from "./item-contexts";

describe("条目上下文查询", () => {
  it("上下文遵守文件边界、跳过空原文并合并相邻目标的完整证据", async () => {
    const item = (item_id: number, src: string, file_path = "script.txt") => ({
      item_id,
      src,
      file_path,
      dst: `译文 ${item_id.toString()}`,
    });
    const rows = [
      item(1, "前文件", "before.txt"),
      item(9, "原文 9"),
      item(10, "  "),
      item(11, "原文 11"),
      item(12, "原文 12"),
      item(13, "\t　"),
      item(14, "原文 14"),
      item(15, "原文 15"),
      item(20, "后文件", "after.txt"),
    ];
    async function* items() {
      yield* rows;
    }
    const result = await queryItemContexts(items(), [12, 14, 999]);
    expect(result).toEqual({
      contexts: [
        { target_item_id: 12, item_ids: [9, 11, 12, 14, 15] },
        { target_item_id: 14, item_ids: [11, 12, 14, 15] },
      ],
      items: rows.filter((row) => [9, 11, 12, 14, 15].includes(row.item_id)),
      missing_item_ids: [999],
    });
  });
});

import { describe, expect, it } from "vitest";

import { resolve_quality_statistics_item_text_change_scope } from "./quality-statistics-invalidation";

describe("resolve_quality_statistics_item_text_change_scope", () => {
  it.each([
    ["翻译批次只影响后置替换统计", "translation_batch_update", false, 0, null, "post_replacement"],
    [
      "状态和重试次数字段不影响统计文本",
      "proofreading_item_patch",
      false,
      0,
      { status: "ERROR", retry_count: 1 },
      "none",
    ],
    [
      "译文字段只影响后置替换统计",
      "proofreading_item_patch",
      false,
      0,
      { name_dst: "艾丽丝" },
      "post_replacement",
    ],
    ["全量替换按全部统计失效处理", "translation_reset", true, 0, null, "all"],
    ["删除按全部统计失效处理", "delete_items", false, 1, null, "all"],
    ["缺少字段补丁时按全部统计失效处理", "unknown_items_change", false, 0, null, "all"],
  ] as const)("%s", (_name, source, fullReplace, deleteCount, fieldPatch, expected) => {
    expect(
      resolve_quality_statistics_item_text_change_scope({
        source,
        fullReplace,
        deleteCount,
        fieldPatch,
      }),
    ).toBe(expected);
  });
});

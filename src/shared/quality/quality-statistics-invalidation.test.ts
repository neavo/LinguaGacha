import { describe, expect, it } from "vitest";

import { resolve_quality_statistics_item_text_change_scope } from "./quality-statistics-invalidation";

describe("resolve_quality_statistics_item_text_change_scope", () => {
  it("翻译批次只影响后置替换统计", () => {
    expect(
      resolve_quality_statistics_item_text_change_scope({
        source: "translation_batch_update",
        fullReplace: false,
        deleteCount: 0,
      }),
    ).toBe("post_replacement");
  });

  it("状态和重试次数字段不影响统计文本", () => {
    expect(
      resolve_quality_statistics_item_text_change_scope({
        source: "proofreading_item_patch",
        fullReplace: false,
        deleteCount: 0,
        fieldPatch: { status: "ERROR", retry_count: 1 },
      }),
    ).toBe("none");
  });

  it("译文字段只影响后置替换统计", () => {
    expect(
      resolve_quality_statistics_item_text_change_scope({
        source: "proofreading_item_patch",
        fullReplace: false,
        deleteCount: 0,
        fieldPatch: { name_dst: "艾丽丝" },
      }),
    ).toBe("post_replacement");
  });

  it("全量替换或删除按全部统计失效处理", () => {
    expect(
      resolve_quality_statistics_item_text_change_scope({
        source: "translation_reset",
        fullReplace: true,
        deleteCount: 0,
      }),
    ).toBe("all");
    expect(
      resolve_quality_statistics_item_text_change_scope({
        source: "delete_items",
        fullReplace: false,
        deleteCount: 1,
      }),
    ).toBe("all");
  });

  it("缺少字段补丁时按全部统计失效处理", () => {
    expect(
      resolve_quality_statistics_item_text_change_scope({
        source: "unknown_items_change",
        fullReplace: false,
        deleteCount: 0,
      }),
    ).toBe("all");
  });
});

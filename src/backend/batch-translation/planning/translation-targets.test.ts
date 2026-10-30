import { describe, expect, it } from "vitest";
import { prepare_translation_targets } from "./translation-targets";

describe("翻译目标准备", () => {
  const items = [
    "NONE",
    "PROCESSED",
    "EXCLUDED",
    "DUPLICATED",
    "RULE_SKIPPED",
    "LANGUAGE_SKIPPED",
  ].map((status, index) => ({
    id: index + 1,
    src: "原文",
    dst: "原有译文",
    status,
    file_path: "chapter.txt",
  }));

  it("ID 与状态取交集并保留完整工程语境", () => {
    const result = prepare_translation_targets(items, [2, 3, 4, 5, 6, 2], ["PROCESSED"]);
    expect([...result.target_ids]).toEqual([2]);
    expect(result.items).toHaveLength(items.length);
    expect(result.items[1]).toMatchObject({
      status: "NONE",
      dst: "原有译文",
    });
    expect(items[1]?.status).toBe("PROCESSED");
    expect(result.items.slice(2)).toEqual(items.slice(2));
  });

  it("仅状态条件可选择全工程任意真实状态", () => {
    expect([...prepare_translation_targets(items, undefined, ["NONE"]).target_ids]).toEqual([1]);
    expect([
      ...prepare_translation_targets(items, undefined, ["PROCESSED", "EXCLUDED"]).target_ids,
    ]).toEqual([2, 3]);
  });

  it("仅 ID 条件纳入所有状态，去重并保持来源顺序", () => {
    const result = prepare_translation_targets(items, [6, 5, 4, 3, 2, 1, 3]);
    expect([...result.target_ids]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.items.every((item) => item.status === "NONE" && item.dst === "原有译文")).toBe(
      true,
    );
    expect(items[1]?.status).toBe("PROCESSED");
  });

  it("重置只清空执行副本中选中条目的译文", () => {
    const result = prepare_translation_targets(items, [2], undefined, true);
    expect(result.items[1]).toMatchObject({ status: "NONE", dst: "" });
    expect(result.items[3]).toEqual(items[3]);
    expect(items[1]).toMatchObject({ status: "PROCESSED", dst: "原有译文" });
  });

  it("失效 ID 即使被状态条件排除也使整个请求失败", () => {
    expect(() => prepare_translation_targets(items, [3, 99], ["NONE"])).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { prepare_translation_targets } from "./translation-targets";

describe("翻译目标准备", () => {
  const items = [
    "NONE",
    "ERROR",
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
    retry_count: 3,
    file_path: "chapter.txt",
  }));

  it.each([false, true])("普通指定范围遵循失败条目决定 %s，并保留工程语境", (include_errors) => {
    const result = prepare_translation_targets(items, {
      operation: "translate",
      mode: "continue",
      include_errors,
      scope: { kind: "items", item_ids: [2, 3, 4, 5, 6, 7, 2] },
    });
    expect([...result.target_ids]).toEqual(include_errors ? [2] : []);
    expect(result.items[1]).toMatchObject({
      status: include_errors ? "NONE" : "ERROR",
      dst: "原有译文",
    });
    expect(items[1]).toMatchObject({ status: "ERROR", retry_count: 3 });
  });

  it("全量补译只选普通待译与确认处理的失败条目", () => {
    const result = prepare_translation_targets(items, {
      operation: "translate",
      mode: "new",
      include_errors: true,
      scope: { kind: "all" },
    });
    expect([...result.target_ids]).toEqual([1, 2]);
  });

  it("明确重翻选择成功条目，并保持工程来源顺序", () => {
    const result = prepare_translation_targets(items, {
      operation: "retranslate",
      scope: { kind: "items", item_ids: [3, 2] },
    });
    expect([...result.target_ids]).toEqual([2, 3]);
    expect(result.items[2]).toMatchObject({ status: "NONE", retry_count: 0 });
    expect(items[2]?.status).toBe("PROCESSED");
  });

  it("失效目标在执行前返回范围错误", () => {
    expect(() =>
      prepare_translation_targets(items, {
        operation: "translate",
        mode: "new",
        scope: { kind: "items", item_ids: [99] },
      }),
    ).toThrow();
  });
});

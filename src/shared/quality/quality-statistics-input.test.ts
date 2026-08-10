import { describe, expect, it } from "vitest";

import { prepare_quality_statistics_task_input } from "./quality-statistics-input";
import { run_quality_statistics_task_sync } from "./quality-statistics";

describe("prepare_quality_statistics_task_input", () => {
  it("原文规则读取 src/name_src，后置替换读取 dst/name_dst", () => {
    const item = { src: "HP +10", dst: "生命值 +10", name_src: "Alice", name_dst: "艾丽丝" };
    const source = prepare_quality_statistics_task_input({
      rule_key: "glossary",
      entries: [{ entry_id: "hp", src: "HP" }],
      items: [item],
    });
    const target = prepare_quality_statistics_task_input({
      rule_key: "post_replacement",
      entries: [{ entry_id: "hp", src: "生命值", regex: false }],
      items: [item],
    });

    expect(source.text_source).toBe("src");
    expect(source.text_groups[0]?.map((part) => part.text)).toEqual(["HP +10", "Alice"]);
    expect(target.text_source).toBe("dst");
    expect(target.text_groups[0]?.map((part) => part.text)).toEqual(["生命值 +10", "艾丽丝"]);
  });

  it("准备稳定条目 ID、规则输入和关系输入", () => {
    const result = prepare_quality_statistics_task_input({
      rule_key: "text_preserve",
      entries: [{ entry_id: "alice", src: "Alice", info: "" }],
      items: [],
    });

    expect(result.entry_ids).toEqual(["alice"]);
    expect(result.rules).toEqual([
      { entry_id: "alice", pattern: "Alice", pattern_kind: "regex", case_sensitive: false },
    ]);
  });

  it("worker 入参准备前执行真实正则编译校验", () => {
    expect(() =>
      prepare_quality_statistics_task_input({
        rule_key: "pre_replacement",
        entries: [{ entry_id: "invalid", src: "(", dst: "x", regex: true }],
        items: [],
      }),
    ).toThrow("Quality rule regex is invalid.");
  });

  it("替换与文本保护按字段内逐行统计", () => {
    const anchored = prepare_quality_statistics_task_input({
      rule_key: "pre_replacement",
      entries: [{ entry_id: "anchored", src: "^JK", dst: "X", regex: true }],
      items: [{ src: "prefix\nJK\nJK" }],
    });
    const cross_line = prepare_quality_statistics_task_input({
      rule_key: "text_preserve",
      entries: [{ entry_id: "cross-line", src: "A\\nB" }],
      items: [{ src: "A\nB" }],
    });
    const cross_line_literal = prepare_quality_statistics_task_input({
      rule_key: "pre_replacement",
      entries: [{ entry_id: "literal", src: "A\nB", dst: "X", regex: false }],
      items: [{ src: "A\nB" }],
    });

    expect(run_quality_statistics_task_sync(anchored).hits_by_entry_id.anchored).toBe(1);
    expect(run_quality_statistics_task_sync(cross_line).hits_by_entry_id["cross-line"]).toBe(0);
    expect(run_quality_statistics_task_sync(cross_line_literal).hits_by_entry_id.literal).toBe(0);
  });
});

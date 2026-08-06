import { describe, expect, it } from "vitest";

import { prepare_quality_statistics_task_input } from "./quality-statistics-input";
import { run_quality_statistics_task_sync } from "./quality-statistics";

describe("prepare_quality_statistics_task_input", () => {
  it("同一原文不同译文只改变后置替换快照", () => {
    const source_items = [
      { src: "HP +10", dst: "生命值 +10", name_src: "Alice", name_dst: "艾丽丝" },
    ];
    const changed_translation_items = [
      { src: "HP +10", dst: "体力 +10", name_src: "Alice", name_dst: "爱丽丝" },
    ];

    const glossary_first = prepare_quality_statistics_task_input({
      rule_key: "glossary",
      entries: [{ entry_id: "hp", src: "HP" }],
      items: source_items,
    });
    const glossary_second = prepare_quality_statistics_task_input({
      rule_key: "glossary",
      entries: [{ entry_id: "hp", src: "HP" }],
      items: changed_translation_items,
    });
    const post_first = prepare_quality_statistics_task_input({
      rule_key: "post_replacement",
      entries: [{ entry_id: "hp", src: "生命值" }],
      items: source_items,
    });
    const post_second = prepare_quality_statistics_task_input({
      rule_key: "post_replacement",
      entries: [{ entry_id: "hp", src: "生命值" }],
      items: changed_translation_items,
    });

    expect(glossary_second.completed_snapshot.snapshot_signature).toBe(
      glossary_first.completed_snapshot.snapshot_signature,
    );
    expect(post_second.completed_snapshot.snapshot_signature).not.toBe(
      post_first.completed_snapshot.snapshot_signature,
    );
  });

  it("同一规则文本不同 entry id 保持依赖签名并区分快照签名", () => {
    const first = prepare_quality_statistics_task_input({
      rule_key: "glossary",
      entries: [{ entry_id: "hp-a", src: "HP" }],
      items: [{ src: "HP", dst: "生命值" }],
    });
    const second = prepare_quality_statistics_task_input({
      rule_key: "glossary",
      entries: [{ entry_id: "hp-b", src: "HP" }],
      items: [{ src: "HP", dst: "生命值" }],
    });

    expect(second.completed_snapshot.dependency_signature).toBe(
      first.completed_snapshot.dependency_signature,
    );
    expect(second.completed_snapshot.snapshot_signature).not.toBe(
      first.completed_snapshot.snapshot_signature,
    );
  });

  it("姓名原文字段变化会改变原文类文本签名", () => {
    const first = prepare_quality_statistics_task_input({
      rule_key: "text_preserve",
      entries: [{ entry_id: "alice", src: "Alice" }],
      items: [{ src: "正文", dst: "", name_src: "Alice", name_dst: "" }],
    });
    const second = prepare_quality_statistics_task_input({
      rule_key: "text_preserve",
      entries: [{ entry_id: "alice", src: "Alice" }],
      items: [{ src: "正文", dst: "", name_src: "Bob", name_dst: "" }],
    });

    expect(second.completed_snapshot.text_signature).not.toBe(
      first.completed_snapshot.text_signature,
    );
  });

  it("worker 入参准备前执行规则真实编译校验", () => {
    expect(() =>
      prepare_quality_statistics_task_input({
        rule_key: "pre_replacement",
        entries: [{ src: "(", dst: "x", regex: true }],
        items: [],
      }),
    ).toThrow("质量规则正则不是合法正则");
  });

  it("context samples 默认关闭且不进入依赖快照", () => {
    const base = prepare_quality_statistics_task_input({
      rule_key: "glossary",
      entries: [{ entry_id: "hp", src: "HP" }],
      items: [{ src: "HP +10" }],
    });
    const samples = prepare_quality_statistics_task_input({
      rule_key: "glossary",
      entries: [{ entry_id: "hp", src: "HP" }],
      items: [{ src: "HP +10" }],
      collect_context_samples: true,
    });

    expect(base.collect_context_samples).toBe(false);
    expect(samples.collect_context_samples).toBe(true);
    expect(samples.completed_snapshot).toEqual(base.completed_snapshot);
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

    expect(run_quality_statistics_task_sync(anchored).results.anchored?.matched_item_count).toBe(1);
    expect(
      run_quality_statistics_task_sync(cross_line).results["cross-line"]?.matched_item_count,
    ).toBe(0);
    expect(
      run_quality_statistics_task_sync(cross_line_literal).results.literal?.matched_item_count,
    ).toBe(0);
  });
});

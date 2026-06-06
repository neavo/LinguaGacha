import { describe, expect, it } from "vitest";

import { prepare_quality_statistics_task_input } from "./quality-statistics-input";

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
});

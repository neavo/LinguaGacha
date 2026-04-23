import { describe, expect, it, vi } from "vitest";

import {
  createQualityStatisticsAutoContext,
  executeQualityStatisticsAutoPlan,
  planQualityStatisticsAutoRun,
  remapQualityStatisticsResults,
} from "./quality-statistics-auto";

function create_glossary_context(args: {
  texts?: string[];
  rules: Array<{
    key: string;
    src: string;
    case_sensitive?: boolean;
  }>;
}) {
  return createQualityStatisticsAutoContext({
    text_source: "src",
    texts: args.texts ?? ["原文"],
    descriptors: args.rules.map((rule) => {
      return {
        key: rule.key,
        dependency_parts: [rule.src, rule.case_sensitive === true],
        relation_label: rule.src,
        rule: {
          key: rule.key,
          pattern: rule.src,
          mode: "glossary",
          case_sensitive: rule.case_sensitive === true,
        },
      };
    }),
  });
}

describe("quality-statistics-auto", () => {
  it("仅改非统计字段时返回 noop", () => {
    const completed_context = create_glossary_context({
      rules: [{ key: "hero", src: "勇者" }],
    });
    const current_context = create_glossary_context({
      rules: [{ key: "hero", src: "勇者" }],
    });

    const auto_plan = planQualityStatisticsAutoRun({
      current_snapshot: current_context.snapshot,
      completed_snapshot: completed_context.snapshot,
    });

    expect(auto_plan.kind).toBe("noop");
  });

  it("单条追加规则时返回 partial，并补算受包含关系影响的规则", () => {
    const completed_context = create_glossary_context({
      rules: [
        { key: "saint-erin", src: "圣女艾琳" },
        { key: "anna", src: "安娜" },
      ],
    });
    const current_context = create_glossary_context({
      rules: [
        { key: "erin", src: "艾琳" },
        { key: "saint-erin", src: "圣女艾琳" },
        { key: "anna", src: "安娜" },
      ],
    });

    const auto_plan = planQualityStatisticsAutoRun({
      current_snapshot: current_context.snapshot,
      completed_snapshot: completed_context.snapshot,
    });

    expect(auto_plan.kind).toBe("partial");
    expect([...auto_plan.target_rule_keys].sort()).toEqual(["erin", "saint-erin"]);
    expect([...auto_plan.relation_target_keys].sort()).toEqual(["erin", "saint-erin"]);
  });

  it("单条规则依赖编辑时返回 partial，并只重算变更规则", () => {
    const completed_context = create_glossary_context({
      rules: [
        { key: "hero", src: "Hero", case_sensitive: false },
        { key: "villain", src: "Villain", case_sensitive: false },
      ],
    });
    const current_context = create_glossary_context({
      rules: [
        { key: "hero", src: "Hero", case_sensitive: true },
        { key: "villain", src: "Villain", case_sensitive: false },
      ],
    });

    const auto_plan = planQualityStatisticsAutoRun({
      current_snapshot: current_context.snapshot,
      completed_snapshot: completed_context.snapshot,
    });

    expect(auto_plan.kind).toBe("partial");
    expect(auto_plan.target_rule_keys).toEqual(["hero"]);
  });

  it("相关文本变化时返回 full", () => {
    const completed_context = create_glossary_context({
      texts: ["第一版"],
      rules: [{ key: "hero", src: "勇者" }],
    });
    const current_context = create_glossary_context({
      texts: ["第二版"],
      rules: [{ key: "hero", src: "勇者" }],
    });

    const auto_plan = planQualityStatisticsAutoRun({
      current_snapshot: current_context.snapshot,
      completed_snapshot: completed_context.snapshot,
    });

    expect(auto_plan.kind).toBe("full");
    expect(auto_plan.reason).toBe("text_changed");
  });

  it("强制全量提示会返回 full", () => {
    const completed_context = create_glossary_context({
      rules: [{ key: "hero", src: "勇者" }],
    });
    const current_context = create_glossary_context({
      rules: [
        { key: "hero", src: "勇者" },
        { key: "mage", src: "法师" },
      ],
    });

    const auto_plan = planQualityStatisticsAutoRun({
      current_snapshot: current_context.snapshot,
      completed_snapshot: completed_context.snapshot,
      force_full: true,
    });

    expect(auto_plan.kind).toBe("full");
    expect(auto_plan.reason).toBe("force_full");
  });

  it("noop 时会把旧结果重映射到当前 key", () => {
    const completed_context = create_glossary_context({
      rules: [{ key: "hero::0", src: "勇者" }],
    });
    const current_context = create_glossary_context({
      rules: [{ key: "hero-entry", src: "勇者" }],
    });

    const remapped_results = remapQualityStatisticsResults({
      completed_snapshot: completed_context.snapshot,
      current_snapshot: current_context.snapshot,
      previous_results: {
        "hero::0": {
          matched_item_count: 2,
          subset_parents: ["大勇者"],
        },
      },
    });

    expect(remapped_results).toEqual({
      "hero-entry": {
        matched_item_count: 2,
        subset_parents: ["大勇者"],
      },
    });
  });

  it("partial 执行时会保留未受影响规则的旧结果", async () => {
    const completed_context = create_glossary_context({
      rules: [
        { key: "erin", src: "艾琳" },
        { key: "anna", src: "安娜" },
      ],
    });
    const current_context = create_glossary_context({
      rules: [
        { key: "erin", src: "艾琳" },
        { key: "saint-erin", src: "圣女艾琳" },
        { key: "anna", src: "安娜" },
      ],
    });
    const auto_plan = planQualityStatisticsAutoRun({
      current_snapshot: current_context.snapshot,
      completed_snapshot: completed_context.snapshot,
    });
    const compute_mock = vi.fn().mockResolvedValue({
      results: {
        erin: {
          matched_item_count: 3,
          subset_parents: ["圣女艾琳"],
        },
        "saint-erin": {
          matched_item_count: 1,
          subset_parents: [],
        },
      },
    });

    const execution_result = await executeQualityStatisticsAutoPlan({
      client: {
        compute: compute_mock,
        dispose: vi.fn(),
      },
      current_snapshot: current_context.snapshot,
      completed_snapshot: completed_context.snapshot,
      previous_results: {
        erin: {
          matched_item_count: 1,
          subset_parents: [],
        },
        anna: {
          matched_item_count: 5,
          subset_parents: [],
        },
      },
      plan: auto_plan,
      rules: current_context.rules,
      relation_candidates: current_context.relation_candidates,
      src_texts: ["艾琳", "安娜"],
      dst_texts: [],
    });

    expect(execution_result).toEqual({
      kind: "success",
      results: {
        erin: {
          matched_item_count: 3,
          subset_parents: ["圣女艾琳"],
        },
        "saint-erin": {
          matched_item_count: 1,
          subset_parents: [],
        },
        anna: {
          matched_item_count: 5,
          subset_parents: [],
        },
      },
    });
    expect(compute_mock).toHaveBeenCalledTimes(1);
  });
});

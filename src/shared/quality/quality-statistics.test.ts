import { describe, expect, it } from "vitest";

import type { ItemTextGroup } from "../item-text";
import { run_quality_statistics_task } from "./quality-statistics";

function text_groups(groups: string[][]): ItemTextGroup[] {
  return groups.map((group) => {
    return group.map((text, index) => {
      return {
        field: index === 0 ? "src" : "name_src",
        text,
      };
    });
  });
}

describe("run_quality_statistics_task", () => {
  it("对 glossary / pre / post / text_preserve 统一返回命中数", async () => {
    const result = await run_quality_statistics_task({
      rules: [
        {
          key: "glossary",
          pattern: "苹果",
          mode: "glossary",
          case_sensitive: true,
        },
        {
          key: "pre-literal",
          pattern: "hero",
          mode: "pre_replacement",
          regex: false,
          case_sensitive: false,
        },
        {
          key: "post-regex",
          pattern: "^苹果$",
          mode: "post_replacement",
          regex: true,
          case_sensitive: true,
        },
        {
          key: "preserve",
          pattern: "^foo\\d+$",
          mode: "text_preserve",
        },
      ],
      srcTextGroups: text_groups([["苹果真甜"], ["Hero 登场"], ["foo42"], ["none"]]),
      dstTextGroups: text_groups([["苹果"], ["hero"], ["bar"], ["foo42"]]),
      relationCandidates: [],
    });

    expect(result.results.glossary?.matched_item_count).toBe(1);
    expect(result.results["pre-literal"]?.matched_item_count).toBe(1);
    expect(result.results["post-regex"]?.matched_item_count).toBe(1);
    expect(result.results.preserve?.matched_item_count).toBe(1);
  });

  it("在非 regex 且忽略大小写时按转义后的正则统计", async () => {
    const result = await run_quality_statistics_task({
      rules: [
        {
          key: "literal-regex-safe",
          pattern: "a+b",
          mode: "pre_replacement",
          regex: false,
          case_sensitive: false,
        },
      ],
      srcTextGroups: text_groups([["xxA+Byy"], ["aab"]]),
      dstTextGroups: [],
      relationCandidates: [],
    });

    expect(result.results["literal-regex-safe"]?.matched_item_count).toBe(1);
  });

  it("对 glossary 保持 casefold 风格的包含关系判断", async () => {
    const result = await run_quality_statistics_task({
      rules: [
        {
          key: "strasse",
          pattern: "STRASSE",
          mode: "glossary",
          case_sensitive: false,
        },
      ],
      srcTextGroups: text_groups([["Die Straße ist lang"]]),
      dstTextGroups: [],
      relationCandidates: [],
    });

    expect(result.results.strasse?.matched_item_count).toBe(1);
  });

  it("非法正则按 0 命中处理", async () => {
    const result = await run_quality_statistics_task({
      rules: [
        {
          key: "broken",
          pattern: "(",
          mode: "text_preserve",
        },
      ],
      srcTextGroups: text_groups([["foo"]]),
      dstTextGroups: text_groups([["bar"]]),
      relationCandidates: [],
    });

    expect(result.results.broken?.matched_item_count).toBe(0);
  });

  it("subset parents 保持去重与原始顺序", async () => {
    const result = await run_quality_statistics_task({
      rules: [
        {
          key: "erin",
          pattern: "艾琳",
          mode: "glossary",
          case_sensitive: true,
        },
      ],
      srcTextGroups: [],
      dstTextGroups: [],
      relationCandidates: [
        { key: "erin", src: "艾琳" },
        { key: "saint-erin", src: "圣女艾琳" },
        { key: "saint-erin-duplicate", src: "圣女艾琳" },
        { key: "captain-erin", src: "舰长艾琳" },
      ],
    });

    expect(result.results.erin?.subset_parents).toEqual(["圣女艾琳", "舰长艾琳"]);
  });

  it("relationTargetCandidates 只为目标候选返回 subset parents", async () => {
    const result = await run_quality_statistics_task({
      rules: [
        {
          key: "erin",
          pattern: "艾琳",
          mode: "glossary",
          case_sensitive: true,
        },
        {
          key: "anna",
          pattern: "安娜",
          mode: "glossary",
          case_sensitive: true,
        },
      ],
      srcTextGroups: text_groups([["艾琳"], ["安娜"]]),
      dstTextGroups: [],
      relationCandidates: [
        { key: "erin", src: "艾琳" },
        { key: "saint-erin", src: "圣女艾琳" },
        { key: "anna", src: "安娜" },
        { key: "queen-anna", src: "冰雪女王安娜" },
      ],
      relationTargetCandidates: [{ key: "anna", src: "安娜" }],
    });

    expect(result.results.anna?.subset_parents).toEqual(["冰雪女王安娜"]);
    expect(result.results.erin?.subset_parents).toEqual([]);
  });

  it("同一 item 的正文和姓名同时命中时只计一次", async () => {
    const result = await run_quality_statistics_task({
      rules: [
        {
          key: "alice",
          pattern: "Alice",
          mode: "glossary",
          case_sensitive: true,
        },
        {
          key: "name-post",
          pattern: "艾丽丝",
          mode: "post_replacement",
          case_sensitive: true,
        },
      ],
      srcTextGroups: text_groups([
        ["Alice 登场", "Alice"],
        ["Bob 登场", "Alice"],
      ]),
      dstTextGroups: text_groups([
        ["艾丽丝登场", "艾丽丝"],
        ["鲍勃登场", ""],
      ]),
      relationCandidates: [],
    });

    expect(result.results.alice?.matched_item_count).toBe(2);
    expect(result.results["name-post"]?.matched_item_count).toBe(1);
  });
});

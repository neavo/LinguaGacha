import { describe, expect, it } from "vitest";

import { collect_project_item_texts } from "./project-item-texts";
import { run_quality_statistics_task } from "./quality-statistics";

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
      srcTexts: ["苹果真甜", "Hero 登场", "foo42", "none"],
      dstTexts: ["苹果", "hero", "bar", "foo42"],
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
      srcTexts: ["xxA+Byy", "aab"],
      dstTexts: [],
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
      srcTexts: ["Die Straße ist lang"],
      dstTexts: [],
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
      srcTexts: ["foo"],
      dstTexts: ["bar"],
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
      srcTexts: [],
      dstTexts: [],
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
      srcTexts: ["艾琳", "安娜"],
      dstTexts: [],
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

  it("collect_project_item_texts 同时抽取 src 与 dst", () => {
    const texts = collect_project_item_texts({
      "1": { src: "原文", dst: "译文" },
      "2": { src: "第二行", dst: "第二译文" },
    });

    expect(texts).toEqual({
      srcTexts: ["原文", "第二行"],
      dstTexts: ["译文", "第二译文"],
    });
  });
});

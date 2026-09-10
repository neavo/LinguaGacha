import { describe, expect, it } from "vitest";

import { has_punctuation_structure_mismatch } from "./punctuation-structure";

describe("has_punctuation_structure_mismatch", () => {
  it.each([
    ["引号转换", "“原文”", "「译文」", false],
    ["同类括号转换", "（原文）", "(译文)", false],
    ["保留半边引号", "“原文", "「译文", false],
    ["补齐半边引号", "“原文", "「译文」", true],
    ["删除半边引号", "“原文”", "「译文", true],
    ["整对删除", "“原文”", "译文", true],
    ["整对增加", "原文", "「译文」", true],
    ["括号方向变化", "（原文）", ")译文(", true],
    ["括号种类变化", "（原文）", "【译文】", true],
    ["不同组的相对顺序变化", "“原文（说明）”", "「译文」(说明)", true],
    ["引号组忽略内部方向与样式", "「原文」", "』译文「", false],
    ["单引号撇号和句读不参与检查", "‘don’t’ < 'text'...?!", "译文，。？！……—", false],
  ])("%s", (_name, src, dst, expected) => {
    expect(has_punctuation_structure_mismatch({ src, dst })).toBe(expected);
  });
});

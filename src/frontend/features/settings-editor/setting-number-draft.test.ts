import { describe, expect, it } from "vitest";

import { parse_bounded_setting_number_draft } from "./setting-number-draft";

describe("setting number draft", () => {
  it.each([
    [" 12 ", 0, 20, 12],
    ["", 0, 20, null],
    ["invalid", 0, 20, null],
    ["-1", 0, 20, null],
    ["21", 0, 20, null],
  ])("将草稿 %j 收窄为边界内有限值 %j", (value, min, max, expected) => {
    expect(parse_bounded_setting_number_draft(value, min, max)).toBe(expected);
  });
});

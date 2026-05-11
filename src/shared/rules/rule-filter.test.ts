import { describe, expect, it } from "vitest";

import { should_skip_by_rule_filter } from "./rule-filter";

describe("rule-filter", () => {
  it("按规则前缀、后缀、正则和数字标点行判断跳过", () => {
    expect(should_skip_by_rule_filter("mapdata/title.png")).toBe(true);
    expect(should_skip_by_rule_filter("voice.ogg")).toBe(true);
    expect(should_skip_by_rule_filter("EV001")).toBe(true);
    expect(should_skip_by_rule_filter("123!!!")).toBe(true);
  });

  it("多行文本只在每一行都命中过滤规则时跳过", () => {
    expect(should_skip_by_rule_filter("123!!!\nvoice.ogg")).toBe(true);
    expect(should_skip_by_rule_filter("123!!!\nplain text")).toBe(false);
  });
});

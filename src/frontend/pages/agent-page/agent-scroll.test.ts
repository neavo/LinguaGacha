import { describe, expect, it } from "vitest";

import { is_at_scroll_end } from "./agent-scroll";

describe("Agent 滚动位置", () => {
  it.each([
    ["距底端 2px", 598, true],
    ["距底端超过 2px", 597, false],
  ])("%s", (_case, scroll_top, expected) => {
    expect(is_at_scroll_end(scroll_target(scroll_top))).toBe(expected);
  });
});

/** 构造固定 1000px 内容与 400px 视口，只让 scrollTop 成为测试变量。 */
function scroll_target(scroll_top: number): HTMLElement {
  const target = document.createElement("div");
  Object.defineProperties(target, {
    scrollHeight: { configurable: true, value: 1_000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: { configurable: true, value: scroll_top },
  });
  return target;
}

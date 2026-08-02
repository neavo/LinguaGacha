import { describe, expect, it } from "vitest";

import { is_at_scroll_end } from "./agent-scroll";

describe("Agent 滚动位置", () => {
  it("只容忍亚像素舍入，真实离开底端后立即暂停跟随", () => {
    expect(is_at_scroll_end(scroll_target(598))).toBe(true);
    expect(is_at_scroll_end(scroll_target(597.9))).toBe(false);
    expect(is_at_scroll_end(scroll_target(120))).toBe(false);
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

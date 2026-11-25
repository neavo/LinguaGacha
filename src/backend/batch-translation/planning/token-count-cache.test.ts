import { describe, expect, it } from "vitest";
import { TokenCountCache } from "./token-count-cache";

describe("TokenCountCache", () => {
  it("命中刷新淘汰顺序，超长文本不挤掉已有计数", () => {
    const cache = new TokenCountCache(300);
    const long_text = "句".repeat(160);
    const oversized = "段".repeat(301);
    cache.set("", 0);
    cache.set("旧文本", 1);
    expect(cache.get("")).toBe(0);
    cache.set(long_text, 2);
    cache.set(oversized, 3);
    expect(cache.get("旧文本")).toBeUndefined();
    expect(cache.get(oversized)).toBeUndefined();
    expect(cache.get(long_text)).toBe(2);
    expect(cache.get("")).toBe(0);
  });
});

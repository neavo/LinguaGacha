import { describe, expect, it } from "vitest";
import { build_token_count_cache_key, TokenCountCache } from "./token-count-cache";

describe("TokenCountCache", () => {
  it("命中刷新 LRU，零计数可以缓存", () => {
    const cache = new TokenCountCache(2);
    cache.set(build_token_count_cache_key(""), 0);
    cache.set(build_token_count_cache_key("旧文本"), 1);
    expect(cache.get(build_token_count_cache_key(""))).toBe(0);
    cache.set(build_token_count_cache_key("新文本"), 2);
    expect(cache.get(build_token_count_cache_key("旧文本"))).toBeUndefined();
    expect(cache.get(build_token_count_cache_key("新文本"))).toBe(2);
    expect(cache.get(build_token_count_cache_key(""))).toBe(0);
  });
});

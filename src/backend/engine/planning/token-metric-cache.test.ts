import { describe, expect, it } from "vitest";

import {
  build_task_token_metric_cache_key,
  count_non_empty_source_lines,
  TASK_PLANNER_TOKENIZER_ID,
  TaskTokenMetricCache,
} from "./token-metric-cache";

describe("token-metric-cache", () => {
  it("cache key 包含 tokenizer 身份、文本长度和稳定 hash", () => {
    const first_key = build_task_token_metric_cache_key("abc");
    const second_key = build_task_token_metric_cache_key("abc");
    const changed_key = build_task_token_metric_cache_key("abcd");

    expect(first_key).toBe(second_key);
    expect(first_key).not.toBe(changed_key);
    expect(first_key).toMatch(new RegExp(`^${TASK_PLANNER_TOKENIZER_ID}:3:[0-9a-f]{64}$`, "u"));
  });

  it("统计非空源文本行数时忽略纯空白行", () => {
    expect(count_non_empty_source_lines("第一行\n\n  \n第二行")).toBe(2);
  });

  it("按 LRU 顺序驱逐最久未访问的 token metric", () => {
    const cache = new TaskTokenMetricCache(2);

    cache.set("a", { token_count: 1.9, line_count: 2.8 });
    cache.set("b", { token_count: 3, line_count: 4 });
    expect(cache.get("a")).toEqual({ token_count: 1, line_count: 2 });
    cache.set("c", { token_count: 5, line_count: 6 });

    expect(cache.size()).toBe(2);
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).toEqual({ token_count: 1, line_count: 2 });
    expect(cache.get("c")).toEqual({ token_count: 5, line_count: 6 });
  });
});

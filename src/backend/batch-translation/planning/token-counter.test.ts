import { describe, expect, it } from "vitest";
import { count_text_tokens, count_token_batch } from "./token-counter";

describe("规划 Token 计数", () => {
  it.each([
    ["", 0],
    ["hello world", 2],
    ["原文", 2],
    ["お誕生日おめでとう", 8],
  ])("按 o200k_base 计数 %s", (text, count) => {
    expect(count_text_tokens(text)).toBe(count);
  });

  it("特殊 token 字面量使用普通文本编码", () => {
    expect(count_text_tokens("<|endoftext|>")).toBeGreaterThan(1);
    expect(count_text_tokens("普通<|endoftext|>文本")).toBeGreaterThan(1);
  });

  it("批量计数让出事件循环，使活动任务可以取消", async () => {
    const controller = new AbortController();
    const reason = new Error("计数已取消");
    const stop = setImmediate(() => controller.abort(reason));
    try {
      await expect(
        count_token_batch(
          Array<string>(10000).fill(
            "彼女は窓の向こうを見つめた。The story continues.\n".repeat(40),
          ),
          controller.signal,
        ),
      ).rejects.toBe(reason);
    } finally {
      clearImmediate(stop);
    }
  });
});

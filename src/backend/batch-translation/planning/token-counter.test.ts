import { describe, expect, it } from "vitest";
import { count_token_batch } from "./token-counter";

describe("规划 Token 计数", () => {
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

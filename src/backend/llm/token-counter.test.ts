import { describe, expect, it } from "vitest";
import { count_text_tokens } from "./token-counter";

describe("文本 Token 计数", () => {
  it("特殊 token 字面量使用普通文本编码", () => {
    expect(count_text_tokens("<|endoftext|>")).toBeGreaterThan(1);
    expect(count_text_tokens("普通<|endoftext|>文本")).toBeGreaterThan(1);
  });
});

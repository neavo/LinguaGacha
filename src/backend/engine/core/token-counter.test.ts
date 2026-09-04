import { describe, expect, it } from "vitest";

import { create_o200k_base_token_counter } from "./token-counter";

describe("create_o200k_base_token_counter", () => {
  it("按 o200k_base 真实计数空文本和中英文文本", () => {
    const counter = create_o200k_base_token_counter();

    expect(counter.count("")).toBe(0);
    expect(counter.count("hello world")).toBe(2);
    expect(counter.count("原文")).toBe(2);
  });

  it("把特殊 token 字面量当普通源文本计数", () => {
    const counter = create_o200k_base_token_counter();

    expect(counter.count("<|endoftext|>")).toBeGreaterThan(1);
    expect(counter.count("普通<|endoftext|>文本")).toBeGreaterThan(1);
  });
});

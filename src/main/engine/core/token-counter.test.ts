import { describe, expect, it } from "vitest";

import {
  CachedTokenCounter,
  TOKEN_COUNTER_CACHE_CAPACITY,
  TOKEN_COUNTER_CACHEABLE_TEXT_MAX_LENGTH,
  create_o200k_base_token_counter,
  type TokenCounterEncoder,
} from "./token-counter";

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

describe("CachedTokenCounter", () => {
  it("重复短文本命中缓存并复用第一次真实计数", () => {
    const { encoder, count_calls } = create_recording_encoder();
    const counter = new CachedTokenCounter(encoder);

    expect(counter.count("重复短句")).toBe(4);
    expect(counter.count("重复短句")).toBe(4);

    expect(count_calls("重复短句")).toBe(1);
  });

  it("长文本不进入 LRU 缓存", () => {
    const { encoder, count_calls } = create_recording_encoder();
    const counter = new CachedTokenCounter(encoder);
    const long_text = "a".repeat(TOKEN_COUNTER_CACHEABLE_TEXT_MAX_LENGTH + 1); // long_text 刚好越过缓存阈值，证明长文本不会污染 LRU

    counter.count(long_text);
    counter.count(long_text);

    expect(count_calls(long_text)).toBe(2);
  });

  it("命中短文本会刷新顺序并在超出容量后淘汰最旧文本", () => {
    const { encoder, count_calls } = create_recording_encoder();
    const counter = new CachedTokenCounter(encoder);

    for (let index = 0; index < TOKEN_COUNTER_CACHE_CAPACITY; index += 1) {
      counter.count(`文本-${index.toString()}`);
    }
    counter.count("文本-0");
    counter.count("新增文本");
    counter.count("文本-0");
    counter.count("文本-1");

    expect(count_calls("文本-0")).toBe(1);
    expect(count_calls("文本-1")).toBe(2);
  });

  /**
   * 构造可观察 encoder，让测试断言公开计数结果和缓存是否复用底层编码
   */
  function create_recording_encoder(): {
    encoder: TokenCounterEncoder;
    count_calls: (text: string) => number;
  } {
    const calls: string[] = []; // calls 记录每次真实编码输入，用于验证缓存命中不会再次调用 encoder
    return {
      encoder: {
        encode: (text) => {
          calls.push(text);
          return Array.from({ length: text.length }, (_value, index) => index);
        },
      },
      count_calls: (text) => calls.filter((item) => item === text).length,
    };
  }
});

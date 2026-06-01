import { describe, expect, it } from "vitest";

import { PromptCache } from "./prompt-cache";

describe("PromptCache", () => {
  it("返回提示词块浅克隆并可清空", () => {
    const cache = new PromptCache();
    cache.replace({ translation: { enabled: true, text: "提示词" } });

    expect(cache.readBlock()).toEqual({ translation: { enabled: true, text: "提示词" } });
    cache.clear();
    expect(cache.readBlock()).toEqual({});
  });
});

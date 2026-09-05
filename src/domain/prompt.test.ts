import { describe, expect, it } from "vitest";

import { normalize_translation_prompt_slice } from "./prompt";

describe("Prompt", () => {
  it("归一提示词切片时只消费顶层启用态", () => {
    expect(
      normalize_translation_prompt_slice({
        text: "自定义提示词",
        enabled: true,
        revision: 2,
      }),
    ).toEqual({
      text: "自定义提示词",
      enabled: true,
      revision: 2,
    });
    expect(
      normalize_translation_prompt_slice({
        text: "旧形状提示词",
        meta: { enabled: true },
        revision: 1,
      }),
    ).toEqual({
      text: "旧形状提示词",
      enabled: false,
      revision: 1,
    });
  });
});

import { describe, expect, it } from "vitest";

import { Prompt } from "./prompt";

describe("Prompt", () => {
  it("只接受公开提示词槽位", () => {
    expect(Prompt.all().map((prompt) => prompt.kind)).toEqual(["translation", "analysis"]);
    expect(Prompt.from_json("translation").kind).toBe("translation");
    expect(() => Prompt.from_json("retranslate")).toThrowError(
      expect.objectContaining({ code: "prompt.unknown_prompt_type" }),
    );
  });

  it("归一提示词切片时只消费顶层启用态", () => {
    const prompt = Prompt.translation();

    expect(
      prompt.normalize_slice({
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
      prompt.normalize_slice({
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

import { describe, expect, it } from "vitest";

import { normalize_translation_prompt_slice, create_empty_project_prompts } from "./prompt";

describe("Prompt", () => {
  it("编辑空快照时保留其它快照的正文", () => {
    const first = create_empty_project_prompts();
    const second = create_empty_project_prompts();
    first.translation.text = "修改";
    expect(second.translation.text).not.toBe(first.translation.text);
  });
  it("归一提示词切片时只消费顶层启用态", () => {
    expect(
      normalize_translation_prompt_slice({
        text: "自定义提示词",
        enabled: true,
        revision: "2.8",
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

import { describe, expect, it } from "vitest";

import { is_app_error } from "../shared/error";
import { Prompt } from "./prompt";

describe("prompt 基础模型", () => {
  it("集中维护提示词任务类型、数据库类型和 meta key", () => {
    expect(Prompt.all().map((prompt) => prompt.kind)).toEqual(["translation", "analysis"]);
    expect(Prompt.from_json("translation").database_type).toBe("translation_prompt");
    expect(Prompt.from_json("analysis").enabled_meta_key).toBe("analysis_prompt_enable");
    expect(Prompt.from_json("analysis").revision_meta_key).toBe("quality_prompt_revision.analysis");
  });

  it("拒绝未知提示词任务类型", () => {
    expect(Prompt.from_json("translation").kind).toBe("translation");
    let code: string | null = null;
    try {
      Prompt.from_json("retranslate");
    } catch (error) {
      code = is_app_error(error) ? error.code : null;
    }
    expect(code).toBe("prompt.unknown_prompt_type");
  });

  it("归一提示词切片时只消费顶层启用态", () => {
    expect(
      Prompt.translation().normalize_slice({
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
      Prompt.translation().normalize_slice({
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

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
});

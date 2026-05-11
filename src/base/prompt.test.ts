import { describe, expect, it } from "vitest";

import {
  PROMPT_TASK_TYPES,
  build_prompt_enabled_meta_key,
  build_prompt_revision_key,
  normalize_prompt_task_type,
  resolve_prompt_database_type,
} from "./prompt";

describe("prompt 基础模型", () => {
  it("集中维护提示词任务类型、数据库类型和 meta key", () => {
    expect(PROMPT_TASK_TYPES).toEqual(["translation", "analysis"]);
    expect(resolve_prompt_database_type("translation")).toBe("translation_prompt");
    expect(build_prompt_enabled_meta_key("analysis")).toBe("analysis_prompt_enable");
    expect(build_prompt_revision_key("analysis")).toBe("quality_prompt_revision.analysis");
  });

  it("拒绝未知提示词任务类型", () => {
    expect(normalize_prompt_task_type("translation")).toBe("translation");
    expect(() => normalize_prompt_task_type("retranslate")).toThrow("未知提示词任务类型");
  });
});

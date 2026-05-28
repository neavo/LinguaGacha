import { describe, expect, it } from "vitest";

import {
  create_translation_reset_all_plan,
  create_translation_reset_failed_plan,
} from "@/project/reset/translation-reset-plan";

describe("translation reset planners", () => {
  it("reset failed 只提交模式和 items revision", () => {
    const plan = create_translation_reset_failed_plan({
      section_revisions: {
        items: 4,
      },
    });

    expect(plan.updatedSections).toEqual(["items"]);
    expect(plan.requestBody).toEqual({
      mode: "failed",
      expected_section_revisions: {
        items: 4,
      },
    });
  });

  it("reset all 只提交模式、设置和 reset 依赖 revision", () => {
    const plan = create_translation_reset_all_plan({
      section_revisions: {
        items: 4,
        analysis: 6,
      },
      source_language: "EN",
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
    });

    expect(plan.updatedSections).toEqual(["items", "analysis"]);
    expect(plan.requestBody).toEqual({
      mode: "all",
      project_settings: {
        source_language: "EN",
        mtool_optimizer_enable: false,
        skip_duplicate_source_text_enable: true,
      },
      expected_section_revisions: {
        items: 4,
        analysis: 6,
      },
    });
  });
});

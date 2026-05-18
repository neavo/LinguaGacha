import { describe, expect, it } from "vitest";

import type { ProjectStoreState } from "@/project/store/project-store";
import {
  create_translation_reset_all_plan,
  create_translation_reset_failed_plan,
} from "@/project/reset/translation-reset-plan";

function create_test_state(): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {},
    items: {},
    quality: {
      glossary: { entries: [], enabled: false, mode: "off", revision: 0 },
      pre_replacement: { entries: [], enabled: false, mode: "off", revision: 0 },
      post_replacement: { entries: [], enabled: false, mode: "off", revision: 0 },
      text_preserve: { entries: [], enabled: false, mode: "off", revision: 0 },
    },
    prompts: {
      translation: { text: "", enabled: false, revision: 0 },
      analysis: { text: "", enabled: false, revision: 0 },
    },
    analysis: {},
    proofreading: {
      revision: 0,
    },
    revisions: {
      projectRevision: 9,
      sections: {
        items: 4,
        analysis: 6,
      },
    },
  };
}

describe("translation reset planners", () => {
  it("reset failed 只提交模式和 items revision", () => {
    const plan = create_translation_reset_failed_plan({
      state: create_test_state(),
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
      state: create_test_state(),
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

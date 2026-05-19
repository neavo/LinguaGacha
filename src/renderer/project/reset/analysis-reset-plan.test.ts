import { describe, expect, it } from "vitest";

import type { ProjectStoreState } from "@/project/store/project-store";
import { createProjectItemIndex } from "@/project/store/project-item-index";
import {
  create_analysis_reset_all_plan,
  create_analysis_reset_failed_plan,
} from "@/project/reset/analysis-reset-plan";

function create_test_state(): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {},
    items: createProjectItemIndex(),
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
        analysis: 4,
      },
    },
  };
}

describe("analysis reset planners", () => {
  it("reset all 只提交模式和 analysis revision", () => {
    const plan = create_analysis_reset_all_plan({
      state: create_test_state(),
    });

    expect(plan.updatedSections).toEqual(["analysis"]);
    expect(plan.requestBody).toEqual({
      mode: "all",
      expected_section_revisions: {
        analysis: 4,
      },
    });
  });

  it("reset failed 只提交模式和 analysis revision", () => {
    const plan = create_analysis_reset_failed_plan({
      state: create_test_state(),
    });

    expect(plan.updatedSections).toEqual(["analysis"]);
    expect(plan.requestBody).toEqual({
      mode: "failed",
      expected_section_revisions: {
        analysis: 4,
      },
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  create_analysis_reset_all_plan,
  create_analysis_reset_failed_plan,
} from "./analysis-reset-plan";

describe("analysis reset planners", () => {
  it("reset all 只提交模式和 analysis revision", () => {
    const plan = create_analysis_reset_all_plan({
      section_revisions: {
        analysis: 4,
      },
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
      section_revisions: {
        analysis: 4,
      },
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

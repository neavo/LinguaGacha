import { describe, expect, it } from "vitest";

import { AnalysisTaskDefinition } from "./analysis-task-definition";

describe("AnalysisTaskDefinition", () => {
  it("分析任务启动前校验质量规则和提示词 revision", () => {
    const definition = new AnalysisTaskDefinition();

    expect(
      definition.revision_dependencies({
        task_type: "analysis",
        mode: "new",
        expected_section_revisions: {},
      }),
    ).toEqual(["quality", "prompts"]);
  });

  it("构造计划时固定 analysis 任务边界", () => {
    const definition = new AnalysisTaskDefinition();

    expect(
      definition.prepare_plan({
        task_type: "analysis",
        mode: "continue",
        expected_section_revisions: {},
      }),
    ).toEqual({
      task_type: "analysis",
      progress: {},
      units: [],
    });
  });
});

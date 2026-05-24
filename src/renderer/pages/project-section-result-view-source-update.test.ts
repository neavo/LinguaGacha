import { describe, expect, it } from "vitest";

import type { ProjectMutationResult } from "@/app/desktop/desktop-project-mutation";
import { REBUILD_RESULT_VIEW_SOURCE_UPDATE } from "@/pages/result-view-snapshot";
import {
  create_project_section_result_view_source_update_request,
  resolve_project_section_mutation_source,
} from "./project-section-result-view-source-update";

describe("project-section-result-view-source-update", () => {
  it("从 mutation result 提取目标项目 section 事实源", () => {
    const mutation_result: ProjectMutationResult = {
      accepted: true,
      changes: [
        {
          source: "quality_rule_save_entries",
          projectPath: "E:/demo/sample.lg",
          projectRevision: 7,
          updatedSections: ["quality"],
          operations: [],
          sectionRevisions: {
            quality: 7,
          },
        },
      ],
    };

    expect(resolve_project_section_mutation_source(mutation_result, "quality")).toEqual({
      projectPath: "E:/demo/sample.lg",
      section: "quality",
      revision: 7,
    });
    expect(
      create_project_section_result_view_source_update_request({
        mutation_result,
        policy: REBUILD_RESULT_VIEW_SOURCE_UPDATE,
        section: "quality",
      }),
    ).toEqual({
      policy: REBUILD_RESULT_VIEW_SOURCE_UPDATE,
      source: {
        projectPath: "E:/demo/sample.lg",
        section: "quality",
        revision: 7,
      },
    });
  });
});

import { describe, expect, it } from "vitest";

import type { ProjectWriteResult } from "@frontend/app/state/desktop-project-write";
import {
  create_project_section_result_refresh,
  resolve_project_section_result_source,
} from "./refresh";
import { REBUILD_RESULT_REFRESH } from "./snapshot";

describe("project section result refresh", () => {
  it("从 write result 提取目标项目 section 事实源", () => {
    const write_result: ProjectWriteResult = {
      accepted: true,
      changes: [
        {
          eventId: "event-1",
          source: "test",
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

    expect(resolve_project_section_result_source(write_result, "quality")).toEqual({
      projectPath: "E:/demo/sample.lg",
      section: "quality",
      revision: 7,
    });
    expect(
      create_project_section_result_refresh({
        write_result,
        policy: REBUILD_RESULT_REFRESH,
        section: "quality",
      }),
    ).toEqual({
      policy: REBUILD_RESULT_REFRESH,
      source: {
        projectPath: "E:/demo/sample.lg",
        section: "quality",
        revision: 7,
      },
    });
  });
});

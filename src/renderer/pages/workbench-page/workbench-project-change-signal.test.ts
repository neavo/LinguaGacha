import { describe, expect, it } from "vitest";

import { resolve_workbench_project_change_signal } from "./workbench-project-change-signal";
import type { ProjectRuntimeChangeSignal } from "@/app/desktop/desktop-runtime-context";

// create_project_signal 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_project_signal(
  overrides: Partial<ProjectRuntimeChangeSignal>,
): ProjectRuntimeChangeSignal {
  return {
    seq: 1,
    reason: "translation_commit",
    updated_sections: ["items"],
    results: [],
    ...overrides,
  };
}

describe("resolve_workbench_project_change_signal", () => {
  it("从 ProjectStore 的 items delta 派生工作台增量刷新信号", () => {
    const signal = resolve_workbench_project_change_signal(
      create_project_signal({
        results: [
          {
            applied: true,
            source: "translation_commit",
            projectRevision: 2,
            updatedSections: ["items"],
            itemDelta: {
              upsertItemIds: [1],
              deleteItemIds: [2],
              fullReplace: false,
            },
            sectionRevisions: { items: 2 },
          },
        ],
      }),
    );

    expect(signal).toEqual({
      seq: 1,
      reason: "translation_commit",
      mode: "items_delta",
      updated_sections: ["items"],
      item_ids: [1, 2],
    });
  });

  it("遇到完整 section 结果时回退到工作台全量刷新", () => {
    const signal = resolve_workbench_project_change_signal(
      create_project_signal({
        reason: "project_read_sections",
        updated_sections: ["project", "files", "items", "analysis"],
        results: [
          {
            applied: true,
            source: "project_read_sections",
            projectRevision: 3,
            updatedSections: ["project", "files", "items", "analysis"],
            itemDelta: {
              upsertItemIds: [],
              deleteItemIds: [],
              fullReplace: true,
            },
            fileDelta: {
              upsertFilePaths: [],
              deleteFilePaths: [],
              fullReplace: true,
            },
            sectionRevisions: { project: 3, files: 3, items: 3, analysis: 3 },
          },
        ],
      }),
    );

    expect(signal).toMatchObject({
      seq: 1,
      reason: "project_read_sections",
      mode: "full",
      item_ids: [],
    });
  });
});

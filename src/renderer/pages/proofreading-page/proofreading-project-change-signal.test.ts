import { describe, expect, it } from "vitest";

import { resolve_proofreading_project_change_signal } from "./proofreading-project-change-signal";
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

describe("resolve_proofreading_project_change_signal", () => {
  it("从 ProjectStore 的 field-patch delta 派生校对增量同步信号", () => {
    const signal = resolve_proofreading_project_change_signal(
      create_project_signal({
        results: [
          {
            applied: true,
            source: "translation_commit",
            projectRevision: 2,
            updatedSections: ["items"],
            itemDelta: {
              upsertItemIds: [1],
              deleteItemIds: [],
              fieldPatch: { dst: "译文", status: "PROCESSED" },
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
      mode: "delta",
      updated_sections: ["items"],
      item_ids: [1],
      field_patch: { dst: "译文", status: "PROCESSED" },
    });
  });

  it("只更新 proofreading section 时派发 noop 信号", () => {
    const signal = resolve_proofreading_project_change_signal(
      create_project_signal({
        reason: "task_status_refresh",
        updated_sections: ["proofreading"],
        results: [
          {
            applied: true,
            source: "task_status_refresh",
            projectRevision: 2,
            updatedSections: ["proofreading"],
            sectionRevisions: { proofreading: 2 },
          },
        ],
      }),
    );

    expect(signal).toMatchObject({
      seq: 1,
      reason: "task_status_refresh",
      mode: "noop",
      item_ids: [],
      field_patch: null,
    });
  });
});

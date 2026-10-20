import { describe, expect, it } from "vitest";

import {
  create_workbench_delete_files_plan,
  create_workbench_import_files_plan,
  create_workbench_reorder_plan,
  create_workbench_reset_file_plan,
  type WorkbenchImportFileCandidate,
  type WorkbenchCommandPlanningState,
} from "./workbench-command-planner";

/** 当前文件与修订用于校验命令目标和提交范围。 */
function create_state(): WorkbenchCommandPlanningState {
  return {
    files: [
      {
        rel_path: "old.txt",
      },
    ],
    section_revisions: {
      files: 1,
      items: 2,
    },
  };
}

/** 提供有效来源，具体场景只覆盖影响当前行为的字段。 */
function create_candidate(): WorkbenchImportFileCandidate {
  return {
    source_path: "E:/demo/new.txt",
    target_rel_path: "new.txt",
    conflict: false,
  };
}

describe("workbench command planner", () => {
  it("重排只接受当前文件完整集合并提交 files revision", () => {
    const state = {
      ...create_state(),
      files: [{ rel_path: "old.txt" }, { rel_path: "new.txt" }],
    };

    expect(
      create_workbench_reorder_plan({
        state,
        ordered_rel_paths: ["new.txt", "old.txt"],
      }),
    ).toEqual({
      updatedSections: ["files"],
      requestBody: {
        ordered_rel_paths: ["new.txt", "old.txt"],
        expected_section_revisions: { files: 1 },
      },
    });
    expect(() => {
      create_workbench_reorder_plan({ state, ordered_rel_paths: ["old.txt"] });
    }).toThrow();
    expect(() => {
      create_workbench_reorder_plan({
        state,
        ordered_rel_paths: ["old.txt", "unknown.txt"],
      });
    }).toThrow();
  });

  it("导入新文件只提交源路径、目标路径、同名策略、继承模式和 revision 锁", () => {
    const plan = create_workbench_import_files_plan({
      state: create_state(),
      preview: { files: [create_candidate()], files_revision: 7 },
      conflict_action: "skip",
      inheritance_mode: "inherit",
    });

    expect(plan.requestBody).toEqual({
      files: [
        {
          source_path: "E:/demo/new.txt",
          target_rel_path: "new.txt",
        },
      ],
      conflict_action: "skip",
      inheritance_mode: "inherit",
      expected_section_revisions: {
        files: 7,
        items: 2,
      },
    });
  });

  it.each(["skip", "replace"] as const)("按后端冲突标记执行 %s 策略", (conflict_action) => {
    const files = [
      create_candidate(),
      {
        source_path: "E:/demo/old-copy.txt",
        target_rel_path: "old.txt",
        conflict: true,
      },
    ];
    const plan = create_workbench_import_files_plan({
      state: create_state(),
      preview: { files, files_revision: 1 },
      conflict_action,
    });
    const expected = [{ source_path: "E:/demo/new.txt", target_rel_path: "new.txt" }];
    if (conflict_action === "replace")
      expected.push({ source_path: "E:/demo/old-copy.txt", target_rel_path: "old.txt" });
    expect(plan.requestBody).toMatchObject({ files: expected, conflict_action });
  });

  it("重置单文件只提交 rel_paths 和受影响 section revision", () => {
    const plan = create_workbench_reset_file_plan({
      state: create_state(),
      rel_path: "old.txt",
    });

    expect(plan.requestBody).toEqual({
      rel_paths: ["old.txt"],
      expected_section_revisions: {
        items: 2,
      },
    });
  });

  it("删除文件只提交 rel_paths 和受影响 section revision", () => {
    const plan = create_workbench_delete_files_plan({
      state: create_state(),
      rel_paths: ["old.txt"],
    });

    expect(plan.requestBody).toEqual({
      rel_paths: ["old.txt"],
      expected_section_revisions: {
        files: 1,
        items: 2,
      },
    });
  });
});

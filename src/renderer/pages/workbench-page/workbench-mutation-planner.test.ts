import { describe, expect, it } from "vitest";

import {
  create_workbench_delete_files_plan,
  create_workbench_import_files_plan,
  create_workbench_import_files_preview,
  create_workbench_planner_settings,
  create_workbench_reset_file_plan,
  type WorkbenchFileParsePreview,
  type WorkbenchMutationPlanningState,
  type WorkbenchPlannerSettings,
} from "@/pages/workbench-page/workbench-mutation-planner";

function create_state(): WorkbenchMutationPlanningState {
  return {
    files: [
      {
        rel_path: "old.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    ],
    section_revisions: {
      files: 1,
      items: 2,
      analysis: 3,
    },
  };
}

function create_parsed_file(): WorkbenchFileParsePreview {
  return {
    source_path: "E:/demo/new.txt",
    target_rel_path: "new.txt",
    file_type: "TXT",
    parsed_items: [{ src: "hello", dst: "", row: 1 }],
  };
}

const SETTINGS: WorkbenchPlannerSettings = {
  source_language: "JA",
  mtool_optimizer_enable: false,
  skip_duplicate_source_text_enable: true,
};

describe("workbench mutation planner", () => {
  it("投影工作台设置时只保留后端预过滤字段", () => {
    const runtime_settings = {
      ...SETTINGS,
      target_language: "ZH",
      request_timeout: 120,
    };

    expect(create_workbench_planner_settings(runtime_settings)).toEqual(SETTINGS);
  });

  it("导入新文件只提交源路径、目标路径、同名策略、继承模式和 revision 锁", () => {
    const plan = create_workbench_import_files_plan({
      state: create_state(),
      parsed_files: [create_parsed_file()],
      conflict_action: "skip",
      settings: SETTINGS,
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
      project_settings: SETTINGS,
      expected_section_revisions: {
        files: 1,
        items: 2,
        analysis: 3,
      },
    });
  });

  it("同名文件预演会分组为替换候选，跳过时只提交非同名文件", () => {
    const parsed_files = [
      create_parsed_file(),
      {
        ...create_parsed_file(),
        source_path: "E:/demo/old-copy.txt",
        target_rel_path: "OLD.txt",
      },
    ];
    const preview = create_workbench_import_files_preview({
      state: create_state(),
      parsed_files,
    });

    expect(preview.new_files.map((file) => file.target_rel_path)).toEqual(["new.txt"]);
    expect(preview.conflicting_files.map((file) => file.target_rel_path)).toEqual(["old.txt"]);

    const plan = create_workbench_import_files_plan({
      state: create_state(),
      parsed_files,
      conflict_action: "skip",
      settings: SETTINGS,
    });

    expect(plan.requestBody).toMatchObject({
      files: [
        {
          source_path: "E:/demo/new.txt",
          target_rel_path: "new.txt",
        },
      ],
      conflict_action: "skip",
    });
  });

  it("同名文件选择替换时会提交新增和替换文件", () => {
    const plan = create_workbench_import_files_plan({
      state: create_state(),
      parsed_files: [
        create_parsed_file(),
        {
          ...create_parsed_file(),
          source_path: "E:/demo/old-copy.txt",
          target_rel_path: "old.txt",
        },
      ],
      conflict_action: "replace",
      settings: SETTINGS,
    });

    expect(plan.requestBody).toMatchObject({
      files: [
        {
          source_path: "E:/demo/new.txt",
          target_rel_path: "new.txt",
        },
        {
          source_path: "E:/demo/old-copy.txt",
          target_rel_path: "old.txt",
        },
      ],
      conflict_action: "replace",
    });
  });

  it("同一批内部重名文件不进入导入计划", () => {
    const preview = create_workbench_import_files_preview({
      state: create_state(),
      parsed_files: [
        create_parsed_file(),
        {
          ...create_parsed_file(),
          source_path: "E:/demo/new-copy.txt",
        },
      ],
    });

    expect(preview.importable_files).toEqual([]);
  });

  it("重置单文件只提交 rel_paths、设置快照和受影响 section revision", () => {
    const plan = create_workbench_reset_file_plan({
      state: create_state(),
      rel_path: "old.txt",
      settings: SETTINGS,
    });

    expect(plan.requestBody).toEqual({
      rel_paths: ["old.txt"],
      project_settings: SETTINGS,
      expected_section_revisions: {
        items: 2,
        analysis: 3,
      },
    });
  });

  it("删除文件只提交 rel_paths、设置快照和受影响 section revision", () => {
    const plan = create_workbench_delete_files_plan({
      state: create_state(),
      rel_paths: ["old.txt"],
      settings: SETTINGS,
    });

    expect(plan.requestBody).toEqual({
      rel_paths: ["old.txt"],
      project_settings: SETTINGS,
      expected_section_revisions: {
        files: 1,
        items: 2,
        analysis: 3,
      },
    });
  });
});

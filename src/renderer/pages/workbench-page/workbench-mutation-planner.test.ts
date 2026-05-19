import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "@base/item";
import type { ProjectStoreState } from "@/project/store/project-store";
import { createProjectItemIndex } from "@/project/store/project-item-index";
import {
  create_workbench_add_files_plan,
  create_workbench_delete_files_plan,
  create_workbench_reset_file_plan,
  type WorkbenchFileParsePreview,
} from "@/pages/workbench-page/workbench-mutation-planner";

function create_state(items: Record<string, ProjectItemPublicRecord>): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {
      "old.txt": {
        rel_path: "old.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    },
    items: createProjectItemIndex(items),
    quality: {
      glossary: { entries: [], enabled: true, mode: "default", revision: 0 },
      pre_replacement: { entries: [], enabled: true, mode: "default", revision: 0 },
      post_replacement: { entries: [], enabled: true, mode: "default", revision: 0 },
      text_preserve: { entries: [], enabled: true, mode: "default", revision: 0 },
    },
    prompts: {
      translation: { text: "", enabled: true, revision: 0 },
      analysis: { text: "", enabled: true, revision: 0 },
    },
    analysis: {},
    proofreading: {
      revision: 0,
    },
    revisions: {
      projectRevision: 1,
      sections: {
        files: 1,
        items: 2,
        analysis: 3,
      },
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

const SETTINGS = {
  source_language: "JA",
  mtool_optimizer_enable: false,
  skip_duplicate_source_text_enable: true,
};

describe("workbench mutation planner", () => {
  it("新增文件只提交源路径、目标路径、继承模式和 revision 锁", () => {
    const plan = create_workbench_add_files_plan({
      state: create_state({}),
      parsed_files: [create_parsed_file()],
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
      inheritance_mode: "inherit",
      project_settings: SETTINGS,
      expected_section_revisions: {
        files: 1,
        items: 2,
        analysis: 3,
      },
    });
  });

  it("新增文件拒绝和现有文件冲突的目标路径", () => {
    expect(() =>
      create_workbench_add_files_plan({
        state: create_state({}),
        parsed_files: [
          {
            ...create_parsed_file(),
            target_rel_path: "old.txt",
          },
        ],
        settings: SETTINGS,
      }),
    ).toThrow("workbench_mutation.target_filename_conflict");
  });

  it("重置单文件只提交 rel_paths、设置快照和受影响 section revision", () => {
    const plan = create_workbench_reset_file_plan({
      state: create_state({}),
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
      state: create_state({}),
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

import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "@base/item";
import type { ProjectStoreState } from "@/project/store/project-store";
import { createProjectItemIndex } from "@/project/store/project-item-index";
import {
  create_clear_translations_plan,
  create_replace_all_plan,
  create_save_item_plan,
  create_set_translation_status_plan,
} from "@/pages/proofreading-page/proofreading-mutation-planner";

function create_test_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

function create_test_state(): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {},
    items: createProjectItemIndex({
      "1": create_test_item({
        item_id: 1,
        file_path: "script/a.txt",
        row_number: 1,
        src: "原文",
        dst: "",
        name_src: "Alice",
        extra_field: { keep: true },
        tag: "dialog",
        file_type: "TXT",
      }),
    }),
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
      revision: 2,
    },
    revisions: {
      projectRevision: 3,
      sections: {
        items: 4,
        proofreading: 2,
      },
    },
  };
}

describe("proofreading mutation planner", () => {
  it("保存译文只提交 item_id、dst 与 revision 锁", () => {
    const plan = create_save_item_plan({
      state: create_test_state(),
      item_id: 1,
      next_dst: "译文",
    });

    expect(plan?.request_body).toEqual({
      item_id: 1,
      dst: "译文",
      expected_section_revisions: {
        items: 4,
        proofreading: 2,
      },
    });
  });

  it("正则全部替换只提交搜索命令并保留变更计数", () => {
    const plan = create_replace_all_plan({
      state: {
        ...create_test_state(),
        items: createProjectItemIndex({
          "1": create_test_item({
            item_id: 1,
            file_path: "script/a.txt",
            row_number: 1,
            src: "原文",
            dst: "Name: Alice",
            status: "NONE",
          }),
        }),
      },
      item_ids: [1],
      search_text: "Name: (.+)",
      replace_text: "$1",
      is_regex: true,
    });

    expect(plan?.request_body).toMatchObject({
      item_ids: [1],
      search_text: "Name: (.+)",
      replace_text: "$1",
      is_regex: true,
      expected_section_revisions: {
        items: 4,
        proofreading: 2,
      },
    });
    expect(plan?.changed_item_ids).toEqual([1]);
  });

  it("清空译文只提交目标 item_ids 并保留状态和重试计数事实给后端", () => {
    const plan = create_clear_translations_plan({
      state: {
        ...create_test_state(),
        items: createProjectItemIndex({
          "1": create_test_item({
            item_id: 1,
            dst: "已有译文",
            status: "PROCESSED",
            retry_count: 3,
          }),
        }),
      },
      item_ids: [1],
    });

    expect(plan).toEqual({
      changed_item_ids: [1],
      request_body: {
        item_ids: [1],
        expected_section_revisions: {
          items: 4,
          proofreading: 2,
        },
      },
    });
  });

  it("设置翻译状态会在状态相同但仍有重试计数时提交清理命令", () => {
    const plan = create_set_translation_status_plan({
      state: {
        ...create_test_state(),
        items: createProjectItemIndex({
          "1": create_test_item({
            item_id: 1,
            dst: "已有译文",
            status: "PROCESSED",
            retry_count: 2,
          }),
        }),
      },
      item_ids: [1],
      status: "PROCESSED",
    });

    expect(plan).toEqual({
      changed_item_ids: [1],
      request_body: {
        item_ids: [1],
        status: "PROCESSED",
        expected_section_revisions: {
          items: 4,
          proofreading: 2,
        },
      },
    });
  });
});

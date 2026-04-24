import { describe, expect, it } from "vitest";

import type { ProjectStoreState } from "@/app/project/store/project-store";
import {
  create_translation_reset_all_plan,
  create_translation_reset_failed_plan,
} from "@/app/project/derived/translation-reset";

function create_test_state(): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {
      "script/a.txt": {
        rel_path: "script/a.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    },
    items: {
      "1": {
        item_id: 1,
        file_path: "script/a.txt",
        row_number: 1,
        src: "失败条目",
        dst: "旧译文",
        status: "ERROR",
        text_type: "NONE",
        retry_count: 2,
      },
      "2": {
        item_id: 2,
        file_path: "script/a.txt",
        row_number: 2,
        src: "已完成条目",
        dst: "完成译文",
        status: "PROCESSED",
        text_type: "NONE",
        retry_count: 0,
      },
    },
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
    analysis: {
      extras: {},
      candidate_count: 4,
      candidate_aggregate: {
        foo: {
          src: "foo",
        },
      },
      status_summary: {
        total_line: 2,
        processed_line: 1,
        error_line: 1,
        line: 2,
      },
    },
    proofreading: {
      revision: 0,
    },
    task: {
      task_type: "translation",
      status: "IDLE",
      busy: false,
      request_in_flight_count: 0,
      line: 2,
      total_line: 2,
      processed_line: 1,
      error_line: 1,
      analysis_candidate_count: 4,
    },
    revisions: {
      projectRevision: 9,
      sections: {
        items: 4,
        analysis: 6,
      },
    },
  };
}

describe("translation reset planners", () => {
  it("reset failed 只重置错误条目并保留分析候选数", () => {
    const plan = create_translation_reset_failed_plan({
      state: create_test_state(),
    });

    expect(plan.updatedSections).toEqual(["items", "task"]);
    expect(plan.patch[0]).toEqual({
      op: "merge_items",
      items: [
        {
          item_id: 1,
          file_path: "script/a.txt",
          row_number: 1,
          src: "失败条目",
          dst: "",
          name_dst: null,
          status: "NONE",
          text_type: "NONE",
          retry_count: 0,
        },
      ],
    });
    expect(plan.requestBody).toMatchObject({
      mode: "failed",
      translation_extras: {
        processed_line: 1,
        error_line: 0,
        total_line: 2,
        line: 1,
      },
      project_status: "PROCESSING",
      expected_section_revisions: {
        items: 4,
      },
    });
    expect(plan.next_task_snapshot.analysis_candidate_count).toBe(4);
  });

  it("reset all 先吃 preview 再输出最终 full item payload", async () => {
    const plan = await create_translation_reset_all_plan({
      state: create_test_state(),
      source_language: "EN",
      mtool_optimizer_enable: false,
      request_preview: async () => {
        return {
          items: [
            {
              id: 11,
              src: "hello",
              dst: "",
              name_src: "Alice",
              name_dst: null,
              extra_field: "",
              tag: "",
              row: 1,
              file_type: "TXT",
              file_path: "script/a.txt",
              text_type: "NONE",
              status: "NONE",
              retry_count: 0,
            },
            {
              id: 12,
              src: "123",
              dst: "",
              name_src: null,
              name_dst: null,
              extra_field: "",
              tag: "",
              row: 2,
              file_type: "TXT",
              file_path: "script/a.txt",
              text_type: "NONE",
              status: "NONE",
              retry_count: 0,
            },
          ],
        };
      },
    });

    expect(plan.updatedSections).toEqual(["items", "analysis", "task"]);
    expect(plan.requestBody).toMatchObject({
      mode: "all",
      project_status: "PROCESSING",
      expected_section_revisions: {
        items: 4,
        analysis: 6,
      },
      translation_extras: {
        processed_line: 0,
        error_line: 0,
        total_line: 1,
        line: 0,
      },
    });
    expect(plan.requestBody.items).toEqual([
      {
        id: 11,
        src: "hello",
        dst: "",
        name_src: "Alice",
        name_dst: null,
        extra_field: "",
        tag: "",
        row: 1,
        file_type: "TXT",
        file_path: "script/a.txt",
        text_type: "NONE",
        status: "NONE",
        retry_count: 0,
      },
      {
        id: 12,
        src: "123",
        dst: "",
        name_src: null,
        name_dst: null,
        extra_field: "",
        tag: "",
        row: 2,
        file_type: "TXT",
        file_path: "script/a.txt",
        text_type: "NONE",
        status: "RULE_SKIPPED",
        retry_count: 0,
      },
    ]);
    expect(plan.next_task_snapshot.analysis_candidate_count).toBe(0);
  });
});

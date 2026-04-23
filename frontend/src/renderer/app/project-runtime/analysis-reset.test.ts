import { describe, expect, it } from "vitest";

import type { ProjectStoreState } from "@/app/project-runtime/project-store";
import {
  create_analysis_reset_all_plan,
  create_analysis_reset_failed_plan,
} from "@/app/project-runtime/analysis-reset";

function create_test_state(): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {},
    items: {
      "1": {
        item_id: 1,
        file_path: "script/a.txt",
        row_number: 1,
        src: "alpha",
        dst: "",
        status: "NONE",
        text_type: "NONE",
        retry_count: 0,
      },
      "2": {
        item_id: 2,
        file_path: "script/a.txt",
        row_number: 2,
        src: "skip",
        dst: "",
        status: "EXCLUDED",
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
      extras: {
        start_time: 12,
        time: 6,
        total_line: 5,
        line: 4,
        processed_line: 3,
        error_line: 1,
        total_tokens: 18,
        total_input_tokens: 10,
        total_output_tokens: 8,
      },
      candidate_count: 6,
      candidate_aggregate: {
        foo: {
          src: "foo",
        },
      },
      status_summary: {
        total_line: 5,
        line: 4,
        processed_line: 3,
        error_line: 1,
      },
    },
    proofreading: {
      revision: 0,
    },
    task: {
      task_type: "analysis",
      status: "IDLE",
      busy: false,
      request_in_flight_count: 0,
      line: 4,
      total_line: 5,
      processed_line: 3,
      error_line: 1,
      total_tokens: 18,
      total_input_tokens: 10,
      total_output_tokens: 8,
      analysis_candidate_count: 6,
    },
    revisions: {
      projectRevision: 9,
      sections: {
        analysis: 4,
      },
    },
  };
}

describe("analysis reset planners", () => {
  it("reset all 生成空 checkpoint 下的分析快照", () => {
    const plan = create_analysis_reset_all_plan({
      state: create_test_state(),
    });

    expect(plan.updatedSections).toEqual(["analysis", "task"]);
    expect(plan.requestBody).toEqual({
      mode: "all",
      analysis_extras: {
        start_time: 0,
        time: 0,
        total_line: 1,
        line: 0,
        processed_line: 0,
        error_line: 0,
        total_tokens: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
      },
      expected_section_revisions: {
        analysis: 4,
      },
    });
    expect(plan.next_task_snapshot.analysis_candidate_count).toBe(0);
  });

  it("reset failed 保留时间与 token 字段，只替换 summary", async () => {
    const plan = await create_analysis_reset_failed_plan({
      state: create_test_state(),
      request_preview: async () => {
        return {
          status_summary: {
            total_line: 5,
            processed_line: 3,
            error_line: 0,
            line: 3,
          },
        };
      },
    });

    expect(plan.updatedSections).toEqual(["analysis", "task"]);
    expect(plan.requestBody).toEqual({
      mode: "failed",
      analysis_extras: {
        start_time: 12,
        time: 6,
        total_line: 5,
        line: 3,
        processed_line: 3,
        error_line: 0,
        total_tokens: 18,
        total_input_tokens: 10,
        total_output_tokens: 8,
      },
      expected_section_revisions: {
        analysis: 4,
      },
    });
    expect(plan.next_task_snapshot.analysis_candidate_count).toBe(6);
  });
});

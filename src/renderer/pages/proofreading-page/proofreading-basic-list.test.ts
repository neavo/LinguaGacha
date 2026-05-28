import { describe, expect, it } from "vitest";

import {
  PROOFREADING_BASIC_VIEW_MARKER,
  build_basic_proofreading_list_view,
  type ProofreadingBasicRuntimeHydrationInput,
} from "@/pages/proofreading-page/proofreading-basic-list";

// create_hydration_input 构造基础列表所需的后端 query 只读快照。
function create_hydration_input(): ProofreadingBasicRuntimeHydrationInput {
  return {
    projectId: "E:/demo/sample.lg",
    revisions: {
      items: 7,
      quality: 3,
      proofreading: 2,
    },
    total_item_count: 3,
    upsertItems: [
      {
        item_id: 1,
        file_path: "chapter-b.txt",
        row_number: 2,
        src: "りんご",
        dst: "苹果",
        status: "NONE",
        text_type: "NONE",
        retry_count: 0,
      },
      {
        item_id: 2,
        file_path: "chapter-a.txt",
        row_number: 1,
        src: "みかん",
        dst: "橘子",
        status: "PROCESSED",
        text_type: "NONE",
        retry_count: 0,
      },
      {
        item_id: 3,
        file_path: "chapter-c.txt",
        row_number: 3,
        src: "ぶどう",
        dst: "葡萄",
        status: "ERROR",
        text_type: "NONE",
        retry_count: 0,
      },
    ],
  };
}

describe("build_basic_proofreading_list_view", () => {
  it("质量 hydrate 未完成时只从后端 query items 构建空质量字段基础行", () => {
    const view = build_basic_proofreading_list_view({
      input: create_hydration_input(),
      query: {
        keyword: "",
        scope: "all",
        is_regex: false,
        sort_state: null,
        window_start: 1,
        window_count: 1,
      },
    });

    expect(view.view_id).toContain(PROOFREADING_BASIC_VIEW_MARKER);
    expect(view.row_count).toBe(3);
    expect(view.window_rows.map((row) => row.row_id)).toEqual(["1"]);
    expect(view.window_rows[0]?.item).toMatchObject({
      warnings: [],
      warning_fragments_by_code: {},
      applied_glossary_terms: [],
      failed_glossary_terms: [],
    });
  });

  it("基础列表响应搜索但非法正则只提示不裁剪结果", () => {
    const matched_view = build_basic_proofreading_list_view({
      input: create_hydration_input(),
      query: {
        keyword: "橘子",
        scope: "dst",
        is_regex: false,
        sort_state: null,
        window_start: 0,
        window_count: 10,
      },
    });
    const invalid_regex_view = build_basic_proofreading_list_view({
      input: create_hydration_input(),
      query: {
        keyword: "[",
        scope: "all",
        is_regex: true,
        sort_state: null,
        window_start: 0,
        window_count: 10,
      },
    });

    expect(matched_view.window_rows.map((row) => row.row_id)).toEqual(["2"]);
    expect(invalid_regex_view.invalid_regex_message).not.toBeNull();
    expect(invalid_regex_view.row_count).toBe(3);
  });
});

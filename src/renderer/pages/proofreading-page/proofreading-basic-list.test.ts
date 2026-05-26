import { describe, expect, it } from "vitest";

import {
  PROOFREADING_BASIC_VIEW_MARKER,
  build_basic_proofreading_list_view,
} from "@/pages/proofreading-page/proofreading-basic-list";
import type { ProofreadingRuntimeHydrationInput } from "@/project/worker/proofreading-ui-worker-service";

// create_hydration_input 构造基础列表所需的 ProjectStore 只读快照。
function create_hydration_input(): ProofreadingRuntimeHydrationInput {
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
    quality: {
      glossary: { enabled: false, mode: "off", revision: 0, entries: [] },
      pre_replacement: { enabled: false, mode: "off", revision: 0, entries: [] },
      post_replacement: { enabled: false, mode: "off", revision: 0, entries: [] },
      text_preserve: { enabled: false, mode: "off", revision: 0, entries: [] },
    },
    sourceLanguage: "JA",
    targetLanguage: "ZH",
  };
}

describe("build_basic_proofreading_list_view", () => {
  it("质量 hydrate 未完成时只从 ProjectStore items 构建空质量字段基础行", () => {
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

import { describe, expect, it } from "vitest";

import { createProofreadingListReader } from "./proofreading-list-reader";
import type { QualitySnapshot } from "../quality/snapshot";

function create_quality(): QualitySnapshot {
  return {
    glossary: {
      enabled: true,
      mode: "custom",
      revision: 1,
      entries: [{ src: "HP", dst: "生命值" }],
    },
    pre_replacement: { enabled: false, mode: "custom", revision: 0, entries: [] },
    post_replacement: { enabled: false, mode: "custom", revision: 0, entries: [] },
    text_preserve: { enabled: false, mode: "off", revision: 0, entries: [] },
  };
}

describe("proofreading-list-reader", () => {
  it("同步后构建带警告、筛选和窗口的列表视图", () => {
    const service = createProofreadingListReader();
    const sync_state = service.sync_full({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 2,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [
        {
          item_id: 1,
          file_path: "b.txt",
          file_order: 1,
          row_number: 1,
          src: "HP",
          dst: "HP",
          status: "PROCESSED",
          text_type: "NONE",
          retry_count: 0,
        },
        {
          item_id: 2,
          file_path: "a.txt",
          file_order: 0,
          row_number: 1,
          src: "菜单",
          dst: "菜单",
          status: "PROCESSED",
          text_type: "NONE",
          retry_count: 0,
        },
      ],
    });

    const view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "HP",
      scope: "all",
      is_regex: false,
      sort_state: null,
      window_start: 0,
      window_count: 10,
    });

    expect(view.row_count).toBe(1);
    expect(view.window_rows[0]?.item).toMatchObject({
      item_id: 1,
      warnings: expect.arrayContaining(["GLOSSARY"]),
      failed_glossary_terms: [["HP", "生命值"]],
    });
    expect(service.read_row_ids_range({ view_id: view.view_id, start: 0, count: 1 })).toEqual([
      "1",
    ]);
  });

  it("非法正则返回错误信息且不裁剪列表结果", () => {
    const service = createProofreadingListReader();
    const sync_state = service.sync_full({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 1,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [
        {
          item_id: 1,
          file_path: "a.txt",
          file_order: 0,
          row_number: 1,
          src: "文本",
          dst: "译文",
          status: "PROCESSED",
          text_type: "NONE",
          retry_count: 0,
        },
      ],
    });

    const view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "(",
      scope: "all",
      is_regex: true,
      sort_state: null,
      window_start: 0,
      window_count: 10,
    });

    expect(view.invalid_regex_message).toContain("Invalid regular expression");
    expect(view.row_count).toBe(1);
  });
});

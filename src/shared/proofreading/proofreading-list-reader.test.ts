import { describe, expect, it } from "vitest";

import { createProofreadingListReader } from "./proofreading-list-reader";
import type { QualitySnapshot } from "../quality/snapshot";

// 提供含术语表的最小质量快照，用于触发 warning 和筛选路径。
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

// 生成 list reader 使用的 item 记录，默认按 item_id 绑定行号。
function create_item(input: {
  item_id: number;
  dst: string;
  status?: string;
  file_order?: number;
  row_number?: number;
}) {
  return {
    item_id: input.item_id,
    file_path: "script.txt",
    file_order: input.file_order ?? 0,
    row_number: input.row_number ?? input.item_id,
    src: `原文 ${input.item_id.toString()}`,
    dst: input.dst,
    status: input.status ?? "NONE",
    text_type: "NONE",
    retry_count: 0,
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

  it("字段 patch 更新旧视图内容但保持当前排序快照", () => {
    const service = createProofreadingListReader();
    const sync_state = service.sync_full({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 2,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [create_item({ item_id: 1, dst: "M" }), create_item({ item_id: 2, dst: "Z" })],
    });
    const view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: { column_id: "dst", direction: "ascending" },
      window_start: 0,
      window_count: 10,
    });

    service.apply_item_delta({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
      total_item_count: 2,
      upsertItems: [],
      patchItemIds: [2],
      fieldPatch: { dst: "A", status: "PROCESSED" },
      deleteItemIds: [],
    });
    const window = service.read_list_window({
      view_id: view.view_id,
      start: 0,
      count: 10,
    });

    expect(window.rows.map((row) => row.row_id)).toEqual(["1", "2"]);
    expect(window.rows[1]?.item).toMatchObject({
      item_id: 2,
      dst: "A",
      status: "PROCESSED",
    });
    expect(service.resolve_row_index({ view_id: view.view_id, row_id: "2" })).toBe(1);
  });

  it("删除 delta 会从旧视图移除对应行并保持剩余索引", () => {
    const service = createProofreadingListReader();
    const sync_state = service.sync_full({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 2,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [create_item({ item_id: 1, dst: "A" }), create_item({ item_id: 2, dst: "B" })],
    });
    const view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
      window_start: 0,
      window_count: 10,
    });

    service.apply_item_delta({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
      total_item_count: 1,
      upsertItems: [],
      patchItemIds: [],
      fieldPatch: null,
      deleteItemIds: [1],
    });
    const window = service.read_list_window({
      view_id: view.view_id,
      start: 0,
      count: 10,
    });

    expect(window.row_count).toBe(1);
    expect(window.rows.map((row) => row.row_id)).toEqual(["2"]);
    expect(service.resolve_row_index({ view_id: view.view_id, row_id: "2" })).toBe(0);
  });

  it("新增 item 不会自动插入旧视图", () => {
    const service = createProofreadingListReader();
    const sync_state = service.sync_full({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 2,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [create_item({ item_id: 1, dst: "A" }), create_item({ item_id: 2, dst: "B" })],
    });
    const view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
      window_start: 0,
      window_count: 10,
    });

    service.apply_item_delta({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
      total_item_count: 3,
      upsertItems: [create_item({ item_id: 3, dst: "C" })],
      patchItemIds: [],
      fieldPatch: null,
      deleteItemIds: [],
    });
    const window = service.read_list_window({
      view_id: view.view_id,
      start: 0,
      count: 10,
    });

    expect(window.row_count).toBe(2);
    expect(window.rows.map((row) => row.row_id)).toEqual(["1", "2"]);
  });

  it("全量同步后旧 view_id 失效", () => {
    const service = createProofreadingListReader();
    const sync_state = service.sync_full({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 1,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [create_item({ item_id: 1, dst: "A" })],
    });
    const view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
      window_start: 0,
      window_count: 10,
    });

    service.sync_full({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
      total_item_count: 1,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [create_item({ item_id: 1, dst: "B" })],
    });

    expect(
      service.read_list_window({
        view_id: view.view_id,
        start: 0,
        count: 10,
      }),
    ).toEqual({
      view_id: view.view_id,
      start: 0,
      row_count: 0,
      rows: [],
    });
  });
});

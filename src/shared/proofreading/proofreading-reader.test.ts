import { describe, expect, it } from "vitest";

import {
  createProofreadingReader,
  evaluateProofreadingSlice,
  type ProofreadingSyncInput,
} from "./proofreading-reader";
import type { QualitySnapshot } from "../quality/quality-rule-snapshot";
import type { ItemNameField } from "../../domain/item";
import { PROOFREADING_WARNING_CODES } from "./proofreading-types";

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

// 生成校对 reader 使用的 item 记录，默认按 item_id 绑定行号。
function create_item(input: {
  item_id: number;
  src?: string;
  dst: string;
  status?: string;
  file_path?: string;
  file_order?: number;
  row_number?: number;
  name_src?: ItemNameField;
  name_dst?: ItemNameField;
}) {
  return {
    item_id: input.item_id,
    file_path: input.file_path ?? "script.txt",
    file_order: input.file_order ?? 0,
    row_number: input.row_number ?? input.item_id,
    src: input.src ?? `原文 ${input.item_id.toString()}`,
    dst: input.dst,
    name_src: input.name_src ?? null,
    name_dst: input.name_dst ?? null,
    status: input.status ?? "NONE",
    text_type: "NONE",
    retry_count: 0,
  };
}

function sync_full(
  service: ReturnType<typeof createProofreadingReader>,
  input: ProofreadingSyncInput,
) {
  return service.sync_evaluated_full({
    ...evaluateProofreadingSlice(input),
    quality: input.quality,
  });
}

describe("proofreading-reader", () => {
  it("warning 分页复用组合筛选与搜索，且不改变 GUI 视图", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 5,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [
        create_item({
          item_id: 1,
          file_path: "b.txt",
          row_number: 2,
          src: "HP",
          dst: "カナ",
          name_src: "Magic",
          name_dst: "魔法",
          status: "PROCESSED",
        }),
        create_item({
          item_id: 2,
          file_path: "a.txt",
          row_number: 3,
          src: "HP",
          dst: "普通译文",
          name_src: "Magic",
          name_dst: "TargetName",
          status: "PROCESSED",
        }),
        create_item({
          item_id: 3,
          file_path: "a.txt",
          row_number: 1,
          src: "メニュー",
          dst: "菜单",
          status: "PROCESSED",
        }),
        create_item({
          item_id: 4,
          file_path: "a.txt",
          row_number: 4,
          src: "失败",
          dst: "",
          status: "ERROR",
        }),
        create_item({
          item_id: 5,
          file_path: "a.txt",
          row_number: 2,
          src: "文本",
          dst: "カナ",
          status: "PROCESSED",
        }),
      ],
    });
    const first_view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
      window_start: 0,
      window_count: 10,
    });

    const first_page = service.read_warning_page({
      warning_types: [...PROOFREADING_WARNING_CODES],
      keyword: "",
      scope: "all",
      is_regex: false,
      case_sensitive: false,
      offset: 0,
      limit: 2,
    });
    expect(first_page.total_item_count).toBe(3);
    expect(first_page.items.map((item) => item.item_id)).toEqual([5, 2]);
    expect(first_page.items[1]).toMatchObject({
      warnings: ["GLOSSARY"],
      glossary_applications: [
        {
          entry_id: "HP::0",
          fields: [{ source_field: "src", target_field: "dst", applied: false }],
        },
      ],
    });

    const combined = service.read_warning_page({
      warning_types: ["GLOSSARY", "KANA"],
      statuses: ["PROCESSED"],
      file_paths: ["b.txt"],
      keyword: "magic",
      scope: "src",
      is_regex: false,
      case_sensitive: false,
      offset: 0,
      limit: 10,
    });
    expect(combined.items).toHaveLength(1);
    expect(combined.items[0]).toMatchObject({
      item_id: 1,
      warnings: expect.arrayContaining(["KANA", "GLOSSARY"]),
      warning_fragments_by_code: { KANA: ["カナ"] },
    });
    expect(
      service.read_warning_page({
        warning_types: ["GLOSSARY"],
        keyword: "targetname",
        scope: "dst",
        is_regex: false,
        case_sensitive: true,
        offset: 0,
        limit: 10,
      }).items,
    ).toEqual([]);

    expect(
      service.read_list_window({ view_id: first_view.view_id, start: 0, count: 10 }).rows,
    ).toEqual(first_view.window_rows);
    expect(
      service.read_row_ids_range({ view_id: first_view.view_id, start: 0, count: 10 }),
    ).toEqual(first_view.window_rows.map((row) => row.row_id));
    expect(service.resolve_row_index({ view_id: first_view.view_id, row_id: "5" })).toBe(1);
    const second_view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(first_view.view_id).toMatch(/:1$/u);
    expect(second_view.view_id).toMatch(/:2$/u);
  });

  it("warning 分页保留非法正则信息且未同步时返回空页", () => {
    const empty_service = createProofreadingReader();
    expect(
      empty_service.read_warning_page({
        warning_types: [...PROOFREADING_WARNING_CODES],
        keyword: "",
        scope: "all",
        is_regex: false,
        case_sensitive: false,
        offset: 0,
        limit: 20,
      }),
    ).toEqual({ total_item_count: 0, items: [], invalid_regex_message: null });

    const service = createProofreadingReader();
    sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 1,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [create_item({ item_id: 1, src: "HP", dst: "普通译文", status: "PROCESSED" })],
    });
    const page = service.read_warning_page({
      warning_types: [...PROOFREADING_WARNING_CODES],
      keyword: "(",
      scope: "all",
      is_regex: true,
      case_sensitive: false,
      offset: 0,
      limit: 20,
    });
    expect(page.invalid_regex_message).toContain("Invalid regular expression");
    expect(page.items.map((item) => item.item_id)).toEqual([1]);
  });

  it("同步后构建带警告、筛选和窗口的列表视图", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
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
          name_src: "Alice",
          name_dst: "艾丽丝",
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
          name_src: null,
          name_dst: null,
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
      glossary_applications: [
        {
          entry_id: "HP::0",
          src: "HP",
          dst: "生命值",
          fields: [{ source_field: "src", target_field: "dst", applied: false }],
        },
      ],
    });
    expect(service.read_row_ids_range({ view_id: view.view_id, start: 0, count: 1 })).toEqual([
      "1",
    ]);
  });

  it("上下文跳过空行并按同文件自然顺序读取前后各两条且不替换当前列表视图", () => {
    const service = createProofreadingReader();
    const items = [
      create_item({ item_id: 1, file_path: "before.txt", file_order: 0, dst: "前文件" }),
      create_item({ item_id: 9, file_path: "script.txt", file_order: 1, dst: "译文 9" }),
      create_item({ item_id: 10, file_path: "script.txt", file_order: 1, src: "  ", dst: "" }),
      create_item({ item_id: 11, file_path: "script.txt", file_order: 1, dst: "译文 11" }),
      create_item({ item_id: 12, file_path: "script.txt", file_order: 1, dst: "译文 12" }),
      create_item({ item_id: 13, file_path: "script.txt", file_order: 1, src: "\t　", dst: "" }),
      create_item({ item_id: 14, file_path: "script.txt", file_order: 1, dst: "译文 14" }),
      create_item({ item_id: 15, file_path: "script.txt", file_order: 1, dst: "译文 15" }),
      create_item({ item_id: 20, file_path: "after.txt", file_order: 2, dst: "后文件" }),
    ];
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: items.length,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: items,
    });
    const view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: { column_id: "src", direction: "descending" },
      window_start: 0,
      window_count: 10,
    });
    const context = service.read_context_items({ row_id: "12" });

    expect(context.map((item) => item.row_id)).toEqual(["9", "11", "12", "14", "15"]);
    expect(context[2]).toMatchObject({
      row_id: "12",
      row_number: 12,
      src: "原文 12",
      dst: "译文 12",
    });
    expect(service.read_list_window({ view_id: view.view_id, start: 0, count: 10 })).toMatchObject({
      view_id: view.view_id,
      rows: view.window_rows,
    });
    expect(service.read_context_items({ row_id: "9" }).map((item) => item.row_id)).toEqual([
      "9",
      "11",
      "12",
    ]);
    expect(service.read_context_items({ row_id: "15" }).map((item) => item.row_id)).toEqual([
      "12",
      "14",
      "15",
    ]);
    expect(service.read_context_items({ row_id: "missing" })).toEqual([]);
  });

  it("非法正则返回错误信息且不裁剪列表结果", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
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
          name_src: null,
          name_dst: null,
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

  it("搜索范围覆盖正文和姓名字段", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 2,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [
        create_item({
          item_id: 1,
          dst: "普通译文",
          name_src: ["Alice", "隐藏姓名"],
          name_dst: ["艾丽丝", "隐藏译名"],
          status: "PROCESSED",
        }),
        create_item({ item_id: 2, dst: "普通译文", status: "PROCESSED" }),
      ],
    });

    const source_view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "Alice",
      scope: "src",
      is_regex: false,
      sort_state: null,
      window_start: 0,
      window_count: 10,
    });
    const translation_view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "艾丽丝",
      scope: "dst",
      is_regex: false,
      sort_state: null,
      window_start: 0,
      window_count: 10,
    });

    expect(source_view.window_rows.map((row) => row.row_id)).toEqual(["1"]);
    expect(translation_view.window_rows.map((row) => row.row_id)).toEqual(["1"]);
  });

  it("字面量搜索按请求的大小写规则筛选", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 1,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [create_item({ item_id: 1, src: "Magic", dst: "译文" })],
    });
    const read = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "magic",
      scope: "src",
      is_regex: false,
      sort_state: null,
      window_start: 0,
      window_count: 10,
    });

    expect(read.window_rows.map((row) => row.row_id)).toEqual(["1"]);
  });

  it("姓名术语缺失进入筛选面板术语计数", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 1,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: {
        ...create_quality(),
        glossary: {
          enabled: true,
          mode: "custom",
          revision: 1,
          entries: [{ src: "Alice", dst: "艾丽丝" }],
        },
      },
      upsertItems: [
        create_item({
          item_id: 1,
          dst: "",
          name_src: ["Alice", "隐藏姓名"],
          name_dst: ["旧译名", "隐藏译名"],
          status: "PROCESSED",
        }),
      ],
    });

    const panel = service.build_filter_panel({
      filters: sync_state.defaultFilters,
    });

    expect(panel.glossary_term_entries).toEqual([
      {
        entry_id: "Alice::0",
        src: "Alice",
        dst: "艾丽丝",
        count: 1,
      },
    ]);
  });

  it("字段 patch 更新旧视图内容但保持当前排序快照", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
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

  it("字段 patch 更新姓名译文并保留数组后续项", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 1,
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      quality: create_quality(),
      upsertItems: [
        {
          ...create_item({ item_id: 1, dst: "正文" }),
          name_src: ["Alice", "Bob"],
          name_dst: ["旧译名", "保留译名"],
        },
      ],
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
      patchItemIds: [1],
      fieldPatch: { name_dst: ["新译名", "保留译名"] },
      deleteItemIds: [],
    });
    const window = service.read_list_window({
      view_id: view.view_id,
      start: 0,
      count: 10,
    });

    expect(window.rows[0]?.item).toMatchObject({
      item_id: 1,
      name_src: ["Alice", "Bob"],
      name_dst: ["新译名", "保留译名"],
    });
  });

  it("删除 delta 会从旧视图移除对应行并保持剩余索引", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
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
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
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
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
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

    sync_full(service, {
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

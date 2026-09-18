import type { PDFDocumentRecord, PDFPageTranslation } from "../pdf";
import { build_proofreading_page_row_id } from "./proofreading-types";
import { describe, expect, it } from "vitest";

import {
  createProofreadingReader,
  evaluateProofreadingSlice,
  type ProofreadingListViewQuery,
  type ProofreadingSyncInput,
} from "./proofreading-reader";
import type { QualitySnapshot } from "../quality/quality-rule-snapshot";
import type { ItemNameField } from "../../domain/item";
import type { ConfiguredSourceLanguageCode, TargetLanguageCode } from "../../domain/language";
import { PROOFREADING_WARNING_CODES } from "./proofreading-types";
import type { TextProcessingConfig } from "../text/text-types";

/** 提供本轮评估使用的语言与注音清理配置。 */
function create_processing_config(
  source_language: ConfiguredSourceLanguageCode = "JA",
  target_language: TargetLanguageCode = "ZH",
): TextProcessingConfig {
  return {
    source_language,
    target_language,
    clean_ruby: false,
  };
}

// 提供含术语表的最小质量快照，用于触发 warning 和筛选路径。
function create_quality(): QualitySnapshot {
  return {
    glossary: {
      enabled: true,
      mode: "custom",
      revision: 1,
      entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
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
  row_number?: number;
  name_src?: ItemNameField;
  name_dst?: ItemNameField;
}) {
  return {
    item_id: input.item_id,
    file_path: input.file_path ?? "script.txt",
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

/** 先执行真实评估，再将结果和质量规则同步到读取器。 */
function sync_full(
  service: ReturnType<typeof createProofreadingReader>,
  input: ProofreadingSyncInput,
) {
  service.sync_evaluated_full({
    ...input,
    ...evaluateProofreadingSlice(input),
  });
  return service.sync_files(
    [...new Set(input.upsertItems.map((item) => item.file_path))].map((rel_path) => ({
      rel_path,
      file_type: "TXT",
    })),
    input.revisions.files,
  );
}

describe("proofreading-reader", () => {
  it("增量维护计数和默认顺序，并保持上下文顺序与旧视图身份", () => {
    const reader = createProofreadingReader();
    const input: ProofreadingSyncInput = {
      projectId: "E:/demo/order.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 3,
      quality: create_quality(),
      processingConfig: create_processing_config(),
      upsertItems: [
        create_item({ item_id: 3, file_path: "b.txt", row_number: 1, dst: "" }),
        create_item({ item_id: 2, file_path: "a.txt", row_number: 1, dst: "" }),
        create_item({ item_id: 10, file_path: "a.txt", row_number: 1, dst: "" }),
      ],
    };
    const initial = sync_full(reader, input);
    const query: ProofreadingListViewQuery = {
      filters: initial.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    };
    const view = reader.read_list_view(query);
    expect(view.window_rows.map((row) => row.row_id)).toEqual(["3", "2", "10"]);
    expect(reader.read_context_items({ row_id: "2" }).map((row) => row.row_id)).toEqual([
      "2",
      "10",
    ]);
    const changed = {
      ...input.upsertItems[2]!,
      file_path: "c.txt",

      status: "PROCESSED",
      dst: "かな",
    };
    const revisions = { ...input.revisions, items: 2 };
    reader.apply_item_delta({
      projectId: input.projectId,
      revisions,
      total_item_count: 2,
      upsertItems: [changed],
      patchItemIds: [],
      fieldPatch: null,
      deleteItemIds: [2],
    });
    expect(
      reader
        .read_list_window({ view_id: view.view_id, start: 0, count: 10 })
        .rows.map((row) => row.row_id),
    ).toEqual(["3", "10"]);
    const fresh = createProofreadingReader();
    const full = sync_full(fresh, {
      ...input,
      revisions,
      total_item_count: 2,
      upsertItems: [input.upsertItems[0]!, changed],
    });
    const updated = reader.sync_files(
      [
        { rel_path: "b.txt", file_type: "TXT" },
        { rel_path: "c.txt", file_type: "TXT" },
      ],
      0,
    );
    expect(updated.defaultFilters).toEqual(full.defaultFilters);
    expect(
      reader.read_list_view({ ...query, filters: updated.defaultFilters }).window_rows,
    ).toEqual(fresh.read_list_view({ ...query, filters: full.defaultFilters }).window_rows);
    expect(reader.build_filter_panel({ filters: updated.defaultFilters })).toEqual(
      fresh.build_filter_panel({ filters: full.defaultFilters }),
    );
    expect(reader.read_warning_summary()).toEqual(fresh.read_warning_summary());
  });

  it("标点警告进入筛选和统计，并在译文修正后增量清除", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 2,
      processingConfig: create_processing_config(),
      quality: create_quality(),
      upsertItems: [
        {
          ...create_item({ item_id: 1, src: "「こんにちは」", dst: "「你好", status: "PROCESSED" }),
          retry_count: 2,
        },
        create_item({ item_id: 2, src: "「こんにちは」", dst: "“你好”", status: "PROCESSED" }),
      ],
    });
    const panel = service.build_filter_panel({ filters: sync_state.defaultFilters });
    expect(panel.outcome_count_by_code.PUNCTUATION_MISMATCH).toBe(1);
    const query: ProofreadingListViewQuery = {
      filters: { ...sync_state.defaultFilters, outcomes: ["PUNCTUATION_MISMATCH"] },
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    };
    const view = service.read_list_view(query);
    expect(view.window_rows.map((row) => row.row_id)).toEqual(["1"]);
    expect(view.window_rows.filter((row) => row.kind === "item")[0]?.item.warnings).toEqual([
      "PUNCTUATION_MISMATCH",
      "RETRY_THRESHOLD",
    ]);
    expect(service.read_warning_summary()).toEqual({
      total_count: 2,
      entries: [
        { code: "PUNCTUATION_MISMATCH", count: 1 },
        { code: "RETRY_THRESHOLD", count: 1 },
      ],
    });

    service.apply_item_delta({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
      total_item_count: 2,
      upsertItems: [],
      patchItemIds: [1],
      fieldPatch: { dst: "“你好”", retry_count: 0 },
      deleteItemIds: [],
    });
    expect(
      service
        .read_list_window({ view_id: view.view_id, start: 0, count: 1 })
        .rows.filter((row) => row.kind === "item")[0]?.item.warnings,
    ).toEqual([]);
    expect(service.read_list_view(query).row_count).toBe(0);
    expect(service.read_warning_summary()).toEqual({ total_count: 0, entries: [] });
  });

  it("默认筛选选中翻译成功和尚未完成两组", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 4,
      processingConfig: create_processing_config(),
      quality: create_quality(),
      upsertItems: [
        create_item({ item_id: 1, dst: "译文", status: "PROCESSED" }),
        create_item({ item_id: 2, dst: "", status: "ERROR" }),
        create_item({ item_id: 3, dst: "", status: "NONE" }),
        create_item({ item_id: 4, dst: "", status: "EXCLUDED" }),
      ],
    });

    const default_view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });

    expect(default_view.window_rows.map((row) => row.row_id)).toEqual(["1", "2", "3"]);
  });

  it("warning 分页复用组合筛选与搜索，且不改变 GUI 视图", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 5,
      processingConfig: create_processing_config(),
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
    service.sync_files(
      [
        { rel_path: "a.txt", file_type: "TXT" },
        { rel_path: "b.txt", file_type: "TXT" },
      ],
      1,
    );
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
      keywords: [],
      scope: "all",
      offset: 0,
      limit: 2,
    });
    expect(first_page.total_item_count).toBe(3);
    expect(first_page.items.map((item) => item.item_id)).toEqual([5, 2]);
    expect(first_page.items[1]).toMatchObject({
      warnings: ["GLOSSARY"],
      glossary_applications: [
        {
          entry_id: "hp",
          fields: [{ source_field: "src", target_field: "dst", applied: false }],
        },
      ],
    });

    const combined = service.read_warning_page({
      warning_types: ["GLOSSARY", "FOREIGN_CHAR_RESIDUE"],
      statuses: ["PROCESSED"],
      file_paths: ["b.txt"],
      keywords: ["magic"],
      scope: "src",
      offset: 0,
      limit: 10,
    });
    expect(combined.items).toHaveLength(1);
    expect(combined.items[0]).toMatchObject({
      item_id: 1,
      warnings: expect.arrayContaining(["FOREIGN_CHAR_RESIDUE", "GLOSSARY"]),
      warning_fragments_by_code: { FOREIGN_CHAR_RESIDUE: ["カナ"] },
    });
    expect(
      service
        .read_warning_page({
          warning_types: ["GLOSSARY"],
          keywords: ["targetname"],
          scope: "dst",
          offset: 0,
          limit: 10,
        })
        .items.map((item) => item.item_id),
    ).toEqual([2]);

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
    expect(second_view.view_id).not.toBe(first_view.view_id);
  });

  it("warning 分页把搜索元字符视为普通文本且未同步时返回空页", () => {
    const empty_service = createProofreadingReader();
    expect(
      empty_service.read_warning_page({
        warning_types: [...PROOFREADING_WARNING_CODES],
        keywords: [],
        scope: "all",
        offset: 0,
        limit: 20,
      }),
    ).toEqual({ total_item_count: 0, items: [] });

    const service = createProofreadingReader();
    sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 1,
      processingConfig: create_processing_config(),
      quality: create_quality(),
      upsertItems: [
        create_item({ item_id: 1, src: "HP (测试)", dst: "普通译文", status: "PROCESSED" }),
      ],
    });
    const page = service.read_warning_page({
      warning_types: [...PROOFREADING_WARNING_CODES],
      keywords: ["("],
      scope: "all",
      offset: 0,
      limit: 20,
    });
    expect(page.items.map((item) => item.item_id)).toEqual([1]);
  });

  it("同步后构建带警告、筛选和窗口的列表视图", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 2,
      processingConfig: create_processing_config(),
      quality: create_quality(),
      upsertItems: [
        {
          item_id: 1,
          file_path: "b.txt",
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
    expect(view.window_rows.filter((row) => row.kind === "item")[0]?.item).toMatchObject({
      item_id: 1,
      warnings: expect.arrayContaining(["GLOSSARY"]),
      glossary_applications: [
        {
          entry_id: "hp",
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

  it("列表锚点直接返回目标附近窗口", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 3,
      processingConfig: create_processing_config(),
      quality: create_quality(),
      upsertItems: [
        create_item({ item_id: 1, dst: "译文 1" }),
        create_item({ item_id: 2, dst: "译文 2" }),
        create_item({ item_id: 3, dst: "译文 3" }),
      ],
    });

    const view = service.read_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
      window_count: 2,
      window_anchor: { row_id: "3", offset: 1 },
    });

    expect(view.window_start).toBe(1);
    expect(view.window_rows.map((row) => row.row_id)).toEqual(["2", "3"]);
  });

  it("上下文跳过空行并按同文件自然顺序读取前后各两条且不替换当前列表视图", () => {
    const service = createProofreadingReader();
    const items = [
      create_item({ item_id: 1, file_path: "before.txt", dst: "前文件" }),
      create_item({ item_id: 9, file_path: "script.txt", dst: "译文 9" }),
      create_item({ item_id: 10, file_path: "script.txt", src: "  ", dst: "" }),
      create_item({ item_id: 11, file_path: "script.txt", dst: "译文 11" }),
      create_item({ item_id: 12, file_path: "script.txt", dst: "译文 12" }),
      create_item({ item_id: 13, file_path: "script.txt", src: "\t　", dst: "" }),
      create_item({ item_id: 14, file_path: "script.txt", dst: "译文 14" }),
      create_item({ item_id: 15, file_path: "script.txt", dst: "译文 15" }),
      create_item({ item_id: 20, file_path: "after.txt", dst: "后文件" }),
    ];
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: items.length,
      processingConfig: create_processing_config(),
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
      processingConfig: create_processing_config(),
      quality: create_quality(),
      upsertItems: [
        {
          item_id: 1,
          file_path: "a.txt",
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
      processingConfig: create_processing_config(),
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
      processingConfig: create_processing_config(),
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
      processingConfig: create_processing_config(),
      quality: {
        ...create_quality(),
        glossary: {
          enabled: true,
          mode: "custom",
          revision: 1,
          entries: [{ entry_id: "alice", src: "Alice", dst: "艾丽丝" }],
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
        entry_id: "alice",
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
      processingConfig: create_processing_config(),
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
    expect(window.rows.filter((row) => row.kind === "item")[1]?.item).toMatchObject({
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
      processingConfig: create_processing_config(),
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

    expect(window.rows.filter((row) => row.kind === "item")[0]?.item).toMatchObject({
      item_id: 1,
      name_src: ["Alice", "Bob"],
      name_dst: ["新译名", "保留译名"],
    });
  });

  it("增量校对沿用全量同步的译前替换规则", () => {
    const service = createProofreadingReader();
    const quality: QualitySnapshot = {
      ...create_quality(),
      pre_replacement: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [
          { entry_id: "replace-a", src: "<A>", dst: "<X>", regex: false, case_sensitive: true },
        ],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "tag", src: "<[^>]+>" }],
      },
    };
    sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 1,
      processingConfig: create_processing_config(),
      quality,
      upsertItems: [
        create_item({ item_id: 1, src: "<A>hello", dst: "<X>你好", status: "PROCESSED" }),
      ],
    });

    service.apply_item_delta({
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
      total_item_count: 1,
      upsertItems: [],
      patchItemIds: [1],
      fieldPatch: { dst: "<X>您好" },
      deleteItemIds: [],
    });

    expect(service.read_items_by_row_ids({ row_ids: ["1"] })[0]?.warnings).not.toContain(
      "TEXT_PRESERVE",
    );
  });

  it("删除 delta 会从旧视图移除对应行并保持剩余索引", () => {
    const service = createProofreadingReader();
    const sync_state = sync_full(service, {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      total_item_count: 2,
      processingConfig: create_processing_config(),
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
      processingConfig: create_processing_config(),
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
      processingConfig: create_processing_config(),
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
      processingConfig: create_processing_config(),
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

it("混合窗口统一工程顺序、页面状态、筛选与计数，并保留内容更新后的结果快照", () => {
  const reader = createProofreadingReader();
  sync_full(reader, {
    projectId: "mixed",
    revisions: { files: 1, items: 1, quality: 0, proofreading: 0 },
    total_item_count: 1,
    quality: create_quality(),
    processingConfig: create_processing_config(),
    upsertItems: [create_item({ item_id: 1, file_path: "a.txt", dst: "" })],
  });
  const documents: PDFDocumentRecord[] = [
    {
      file_path: "b.pdf",
      document: {
        digest: "source",
        pages: (
          [
            null,
            { kind: "translate", markdown: "needle" },
            { kind: "keep", reason: "封面" },
            { kind: "omit", reason: "空页" },
            { kind: "translate", markdown: "" },
          ] satisfies PDFPageTranslation[]
        ).map((translation, index) => ({
          page: index + 1,
          width: 300,
          height: 300,
          rotation: 0,
          label: null,
          translation,
          reviewed: false,
          notes: "",
        })),
      },
    },
  ];
  const files = [
    { rel_path: "b.pdf", file_type: "PDF" },
    { rel_path: "a.txt", file_type: "TXT" },
    { rel_path: "empty.txt", file_type: "NONE" },
  ];
  reader.sync_files(files, 1);
  const sync = reader.sync_pages(documents, 1);
  const query: ProofreadingListViewQuery = {
    filters: sync.defaultFilters,
    keyword: "",
    scope: "all",
    is_regex: false,
    sort_state: null,
  };
  const page_id = (page: number) => build_proofreading_page_row_id("b.pdf", page);
  const view = reader.read_list_view(query);
  expect(view.window_rows.map((row) => row.row_id)).toEqual([
    page_id(1),
    page_id(2),
    page_id(5),
    "1",
  ]);
  expect(sync.files.map((file) => file.file_path)).toEqual(["b.pdf", "a.txt", "empty.txt"]);
  expect(sync.files.map((file) => file.count)).toEqual([5, 1, 0]);
  const all_filters = {
    ...query.filters,
    outcomes: ["NONE", "NO_WARNING", "RULE_SKIPPED", "EXCLUDED"],
  };
  const all_view = reader.read_list_view({ ...query, filters: all_filters });
  expect(
    all_view.window_rows.filter((row) => row.kind === "page").map((row) => row.page.status),
  ).toEqual(["NONE", "PROCESSED", "RULE_SKIPPED", "EXCLUDED", "PROCESSED"]);
  for (const direction of ["ascending", "descending"] as const) {
    const sorted = reader.read_list_view({
      ...query,
      filters: all_filters,
      sort_state: { column_id: "dst", direction },
    });
    expect(sorted.window_rows.map((row) => row.row_id)).toEqual(
      [1, 2, 3, 4, 5].map(page_id).concat("1"),
    );
  }
  const statuses = [
    ["NONE", [page_id(1), "1"]],
    ["NO_WARNING", [page_id(2), page_id(5)]],
    ["RULE_SKIPPED", [page_id(3)]],
    ["EXCLUDED", [page_id(4)]],
    ["GLOSSARY", []],
  ] as const;
  for (const [outcome, expected] of statuses) {
    expect(
      reader
        .read_list_view({ ...query, filters: { ...all_filters, outcomes: [outcome] } })
        .window_rows.map((row) => row.row_id),
    ).toEqual(expected);
  }
  expect(reader.read_items_by_row_ids({ row_ids: [page_id(2), page_id(3)] })).toEqual([]);
  expect(reader.read_list_view({ ...query, keyword: "needle", scope: "dst" }).row_count).toBe(1);
  expect(reader.read_list_view({ ...query, keyword: "needle", scope: "src" }).row_count).toBe(0);
  expect(
    reader.read_list_view({ ...query, filters: { ...query.filters, file_paths: [] } }).row_count,
  ).toBe(0);
  expect(
    reader.read_list_view({
      ...query,
      filters: { ...all_filters, glossary_entry_ids: ["hp"], include_without_glossary_miss: false },
    }).row_count,
  ).toBe(0);
  expect(
    reader.read_list_view({
      ...query,
      filters: { ...all_filters, glossary_entry_ids: [], include_without_glossary_miss: true },
    }).row_count,
  ).toBe(6);
  expect(
    reader.read_list_view({ ...query, filters: { ...all_filters, outcomes: [] } }).row_count,
  ).toBe(0);
  expect(
    reader
      .read_list_view({ ...query, filters: { ...all_filters, file_paths: ["a.txt"] } })
      .window_rows.map((row) => row.kind),
  ).toEqual(["item"]);
  expect(reader.build_filter_panel({ filters: query.filters })).toMatchObject({
    outcome_count_by_code: { NONE: 2, NO_WARNING: 2, RULE_SKIPPED: 1, EXCLUDED: 1 },
    without_glossary_miss_count: 4,
  });
  expect(
    reader.build_filter_panel({ filters: { ...all_filters, file_paths: ["b.pdf"] } }),
  ).toMatchObject({
    outcome_count_by_code: { NONE: 1, NO_WARNING: 2, RULE_SKIPPED: 1, EXCLUDED: 1 },
    without_glossary_miss_count: 5,
    glossary_term_entries: [],
  });
  expect(reader.read_warning_summary()).toEqual({ total_count: 0, entries: [] });
  reader.sync_files([files[1]!, files[0]!, files[2]!], 2);
  expect(reader.read_list_window({ view_id: all_view.view_id, start: 0, count: 10 }).rows).toEqual(
    [],
  );
  expect(
    reader.read_list_view({ ...query, filters: all_filters }).window_rows.map((row) => row.row_id),
  ).toEqual(["1", ...[1, 2, 3, 4, 5].map(page_id)]);
  const stable = reader.read_list_view({ ...query, keyword: "needle" });
  documents[0]!.document.pages[1]!.translation = { kind: "translate", markdown: "updated" };
  reader.sync_pages(documents, 2);
  const window = reader.read_list_window({ view_id: stable.view_id, start: 0, count: 10 });
  expect(window.rows).toMatchObject([
    {
      kind: "page",
      page: { page: 2, status: "PROCESSED" },
    },
  ]);
  expect(
    reader.resolve_row_index({ view_id: stable.view_id, row_id: window.rows[0]!.row_id }),
  ).toBe(0);
  expect(reader.read_list_view({ ...query, keyword: "needle" }).row_count).toBe(0);
});

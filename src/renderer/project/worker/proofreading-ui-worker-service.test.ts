import { describe, expect, it } from "vitest";

import { createProofreadingUiWorkerService } from "./proofreading-ui-worker-service";
import {
  PROOFREADING_STATUS_ORDER,
  PROOFREADING_WARNING_CODES,
} from "@/pages/proofreading-page/types";

const ALL_STATUS_FILTERS = [...PROOFREADING_STATUS_ORDER];
const DEFAULT_STATUS_FILTERS = ["NONE", "PROCESSED", "ERROR"];

function create_runtime_revisions(proofreading: number, quality = proofreading) {
  return {
    items: proofreading,
    quality,
    proofreading,
  };
}

function create_quality_state() {
  return {
    glossary: {
      enabled: true,
      mode: "off",
      revision: 1,
      entries: [
        {
          src: "foo",
          dst: "baz",
        },
      ],
    },
    pre_replacement: {
      enabled: false,
      mode: "off",
      revision: 0,
      entries: [],
    },
    post_replacement: {
      enabled: false,
      mode: "off",
      revision: 0,
      entries: [],
    },
    text_preserve: {
      enabled: false,
      mode: "off",
      revision: 0,
      entries: [],
    },
  };
}

function create_runtime_item(
  overrides: Partial<ReturnType<typeof create_hydration_input>["upsertItems"][number]>,
) {
  return {
    item_id: 100,
    file_path: "fixture.txt",
    row_number: 1,
    src: "source",
    dst: "translation",
    status: "PROCESSED",
    text_type: "NONE",
    retry_count: 0,
    ...overrides,
  };
}

function create_hydration_input() {
  return {
    projectId: "demo",
    revisions: create_runtime_revisions(3),
    total_item_count: 2,
    quality: create_quality_state(),
    sourceLanguage: "JA",
    targetLanguage: "ZH",
    upsertItems: [
      {
        item_id: 1,
        file_path: "a.txt",
        row_number: 1,
        src: "foo",
        dst: "bar",
        status: "PROCESSED",
        text_type: "NONE",
        retry_count: 0,
      },
      {
        item_id: 2,
        file_path: "b.txt",
        row_number: 2,
        src: "alpha",
        dst: "beta",
        status: "NONE",
        text_type: "NONE",
        retry_count: 0,
      },
    ],
  };
}

function create_skipped_status_hydration_input() {
  return {
    projectId: "demo",
    revisions: create_runtime_revisions(4),
    total_item_count: 6,
    quality: create_quality_state(),
    sourceLanguage: "JA",
    targetLanguage: "ZH",
    upsertItems: [
      create_runtime_item({
        item_id: 3,
        file_path: "c.txt",
        row_number: 3,
        src: "gamma",
        dst: "delta",
        status: "EXCLUDED",
      }),
      create_runtime_item({
        item_id: 4,
        file_path: "c.txt",
        row_number: 4,
        src: "rule",
        dst: "rule skipped",
        status: "RULE_SKIPPED",
      }),
      create_runtime_item({
        item_id: 5,
        file_path: "c.txt",
        row_number: 5,
        src: "language",
        dst: "language skipped",
        status: "LANGUAGE_SKIPPED",
      }),
      create_runtime_item({
        item_id: 6,
        file_path: "c.txt",
        row_number: 6,
        src: "duplicated",
        dst: "duplicated",
        status: "DUPLICATED",
      }),
      create_runtime_item({
        item_id: 7,
        file_path: "c.txt",
        row_number: 7,
        src: "none",
        dst: "none status",
        status: "NONE",
      }),
      create_runtime_item({
        item_id: 8,
        file_path: "c.txt",
        row_number: 8,
        src: "",
        dst: "empty source is still reviewed",
        status: "PROCESSED",
      }),
    ],
  };
}

describe("createProofreadingUiWorkerService", () => {
  it("hydrate_full 后列表、默认筛选与筛选面板会基于 worker 缓存一致产出", () => {
    const engine = createProofreadingUiWorkerService();

    const sync_state = engine.hydrate_full(create_hydration_input());
    expect(sync_state).toMatchObject({
      projectId: "demo",
      targetLanguage: "ZH",
      revisions: create_runtime_revisions(3),
      defaultFilters: {
        warning_types: [...PROOFREADING_WARNING_CODES],
        statuses: DEFAULT_STATUS_FILTERS,
        file_paths: ["a.txt", "b.txt"],
        glossary_terms: [["foo", "baz"]],
      },
    });

    const list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view).toMatchObject({
      projectId: "demo",
      revisions: create_runtime_revisions(3),
      row_count: 2,
    });
    expect(list_view.window_rows.map((item) => item.row_id)).toEqual(["1", "2"]);
    expect(
      engine.resolve_row_index({
        view_id: list_view.view_id,
        row_id: "2",
      }),
    ).toBe(1);
    expect(list_view.window_rows[0]?.item.failed_glossary_terms).toEqual([["foo", "baz"]]);

    const filter_panel = engine.build_filter_panel({
      filters: sync_state.defaultFilters,
    });
    expect(filter_panel.available_warning_types).toEqual([...PROOFREADING_WARNING_CODES]);
    expect(filter_panel.status_count_by_code).toMatchObject({
      NONE: 1,
      PROCESSED: 1,
    });
    expect(filter_panel.warning_count_by_code).toMatchObject({
      GLOSSARY: 1,
      NO_WARNING: 1,
    });
    expect(filter_panel.file_count_by_path).toMatchObject({
      "a.txt": 1,
      "b.txt": 1,
    });
    expect(filter_panel.glossary_term_entries).toEqual([
      {
        term: ["foo", "baz"],
        count: 1,
      },
    ]);
    expect(filter_panel.without_glossary_miss_count).toBe(1);
  });

  it("列表搜索保持字面量大小写不敏感，非法正则只提示不裁剪结果", () => {
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full(create_hydration_input());

    const literal_list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "ALPHA",
      scope: "src",
      is_regex: false,
      sort_state: null,
    });
    expect(literal_list_view.window_rows.map((item) => item.row_id)).toEqual(["2"]);
    expect(literal_list_view.invalid_regex_message).toBeNull();

    const invalid_regex_list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "[",
      scope: "src",
      is_regex: true,
      sort_state: null,
    });
    expect(invalid_regex_list_view.row_count).toBe(2);
    expect(invalid_regex_list_view.invalid_regex_message).not.toBeNull();
  });

  it("dispose_project 只释放身份匹配的项目缓存", () => {
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full(create_hydration_input());

    engine.dispose_project("other-project");
    expect(
      engine.build_list_view({
        filters: sync_state.defaultFilters,
        keyword: "",
        scope: "all",
        is_regex: false,
        sort_state: null,
      }).row_count,
    ).toBe(2);

    engine.dispose_project("demo");
    expect(
      engine.build_list_view({
        filters: sync_state.defaultFilters,
        keyword: "",
        scope: "all",
        is_regex: false,
        sort_state: null,
      }).row_count,
    ).toBe(0);
  });

  it("apply_item_delta 只更新变更条目与相关计数，不回退整页重建结果", () => {
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full(create_hydration_input());
    const old_list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "foo",
      scope: "src",
      is_regex: false,
      sort_state: null,
    });
    expect(old_list_view.window_rows.map((row) => row.row_id)).toEqual(["1"]);

    const delta_state = engine.apply_item_delta({
      projectId: "demo",
      revisions: create_runtime_revisions(4, 3),
      total_item_count: 2,
      upsertItems: [
        {
          item_id: 1,
          file_path: "a.txt",
          row_number: 1,
          src: "foo",
          dst: "baz",
          status: "NONE",
          text_type: "NONE",
          retry_count: 0,
        },
      ],
      patchItemIds: [],
      fieldPatch: null,
      deleteItemIds: [],
    });

    expect(delta_state).toMatchObject({
      projectId: "demo",
      revisions: create_runtime_revisions(4, 3),
      defaultFilters: {
        warning_types: [...PROOFREADING_WARNING_CODES],
        statuses: DEFAULT_STATUS_FILTERS,
        file_paths: ["a.txt", "b.txt"],
        glossary_terms: [],
      },
    });

    const old_window = engine.read_list_window({
      view_id: old_list_view.view_id,
      start: 0,
      count: 10,
    });
    expect(old_window.row_count).toBe(1);
    expect(old_window.rows[0]?.row_id).toBe("1");
    expect(old_window.rows[0]?.item.dst).toBe("baz");

    const list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.row_count).toBe(2);
    expect(list_view.window_rows[0]?.item.dst).toBe("baz");
    expect(list_view.window_rows[0]?.item.failed_glossary_terms).toEqual([]);
    expect(list_view.window_rows[1]?.item.dst).toBe("beta");

    const filter_panel = engine.build_filter_panel({
      filters: delta_state.defaultFilters,
    });
    expect(filter_panel.warning_count_by_code).toMatchObject({
      NO_WARNING: 2,
    });
    expect(filter_panel.status_count_by_code).toMatchObject({
      NONE: 2,
    });
    expect(filter_panel.file_count_by_path).toMatchObject({
      "a.txt": 1,
      "b.txt": 1,
    });
    expect(filter_panel.glossary_term_entries).toEqual([]);
    expect(filter_panel.without_glossary_miss_count).toBe(2);
  });

  it("apply_item_delta 支持字段级 patch 并保留 worker 内完整条目事实", () => {
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full(create_hydration_input());

    const delta_state = engine.apply_item_delta({
      projectId: "demo",
      revisions: create_runtime_revisions(4, 3),
      total_item_count: 2,
      upsertItems: [],
      patchItemIds: [2],
      fieldPatch: {
        status: "PROCESSED",
        retry_count: 0,
      },
      deleteItemIds: [],
    });

    const list_view = engine.build_list_view({
      filters: delta_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });

    expect(list_view.row_count).toBe(2);
    expect(list_view.window_rows[1]?.item).toMatchObject({
      item_id: 2,
      dst: "beta",
      status: "PROCESSED",
    });
    expect(
      engine.build_filter_panel({ filters: sync_state.defaultFilters }).status_count_by_code,
    ).toMatchObject({
      PROCESSED: 2,
    });
  });

  it("重翻完成后即使状态脱离筛选条件，也保留旧视图成员供用户确认", () => {
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full(create_hydration_input());
    const old_list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(old_list_view.window_rows.map((row) => row.row_id)).toEqual(["1", "2"]);

    engine.apply_item_delta({
      projectId: "demo",
      revisions: create_runtime_revisions(4, 3),
      total_item_count: 2,
      upsertItems: [],
      patchItemIds: [2],
      fieldPatch: {
        status: "EXCLUDED",
        retry_count: 0,
      },
      deleteItemIds: [],
    });

    const old_window = engine.read_list_window({
      view_id: old_list_view.view_id,
      start: 0,
      count: 10,
    });
    expect(old_window.row_count).toBe(2);
    expect(old_window.rows.map((row) => row.row_id)).toEqual(["1", "2"]);
    expect(old_window.rows[1]?.item.status).toBe("EXCLUDED");
  });

  it("重翻完成后即使译文改变排序键，也保留旧视图顺序供用户确认", () => {
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full(create_hydration_input());
    const old_list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: {
        column_id: "dst",
        direction: "ascending",
      },
    });
    expect(old_list_view.window_rows.map((row) => row.row_id)).toEqual(["1", "2"]);

    engine.apply_item_delta({
      projectId: "demo",
      revisions: create_runtime_revisions(4, 3),
      total_item_count: 2,
      upsertItems: [],
      patchItemIds: [2],
      fieldPatch: {
        dst: "aardvark",
      },
      deleteItemIds: [],
    });

    const old_window = engine.read_list_window({
      view_id: old_list_view.view_id,
      start: 0,
      count: 10,
    });
    expect(old_window.row_count).toBe(2);
    expect(old_window.rows.map((row) => row.row_id)).toEqual(["1", "2"]);
    expect(old_window.rows[1]?.item.dst).toBe("aardvark");
  });

  it("apply_item_delta 支持 tombstone 删除并从当前列表快照剪除对应 id", () => {
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full({
      ...create_hydration_input(),
      revisions: {
        items: 3,
        quality: 1,
        proofreading: 3,
      },
    });
    const old_list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });

    const delta_state = engine.apply_item_delta({
      projectId: "demo",
      revisions: {
        items: 4,
        quality: 1,
        proofreading: 4,
      },
      total_item_count: 1,
      upsertItems: [],
      patchItemIds: [],
      fieldPatch: null,
      deleteItemIds: [1],
    });
    const old_window = engine.read_list_window({
      view_id: old_list_view.view_id,
      start: 0,
      count: 10,
    });
    expect(old_window.row_count).toBe(1);
    expect(old_window.rows.map((row) => row.row_id)).toEqual(["2"]);

    const next_list_view = engine.build_list_view({
      filters: delta_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(next_list_view.view_id).not.toBe(old_list_view.view_id);
    expect(next_list_view.window_rows.map((row) => row.row_id)).toEqual(["2"]);

    const filter_panel = engine.build_filter_panel({
      filters: delta_state.defaultFilters,
    });
    expect(filter_panel.file_count_by_path).toEqual({ "b.txt": 1 });
    expect(filter_panel.glossary_term_entries).toEqual([]);
  });

  it("跳过 warning 的状态仍进入筛选源并计为无警告", () => {
    const engine = createProofreadingUiWorkerService();

    const sync_state = engine.hydrate_full(create_skipped_status_hydration_input());
    expect(sync_state.defaultFilters.statuses).toEqual(DEFAULT_STATUS_FILTERS);

    const filter_panel = engine.build_filter_panel({
      filters: sync_state.defaultFilters,
    });
    expect(filter_panel.available_statuses).toEqual(ALL_STATUS_FILTERS);
    expect(filter_panel.status_count_by_code).toMatchObject({
      EXCLUDED: 1,
      RULE_SKIPPED: 1,
      LANGUAGE_SKIPPED: 1,
      DUPLICATED: 1,
      NONE: 1,
      PROCESSED: 1,
    });
    expect(filter_panel.warning_count_by_code).toMatchObject({
      NO_WARNING: 2,
    });

    const all_status_filter_panel = engine.build_filter_panel({
      filters: {
        ...sync_state.defaultFilters,
        statuses: ALL_STATUS_FILTERS,
      },
    });
    expect(all_status_filter_panel.warning_count_by_code).toMatchObject({
      NO_WARNING: 6,
    });

    const list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.window_rows.map((item) => item.row_id)).toEqual(["7", "8"]);

    const all_status_list_view = engine.build_list_view({
      filters: {
        ...sync_state.defaultFilters,
        statuses: ALL_STATUS_FILTERS,
      },
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(all_status_list_view.window_rows.map((item) => item.row_id)).toEqual([
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
  });

  it("假名残留只在日文源语言检查，并排除 TextBase 中的假名符号例外", () => {
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full({
      projectId: "demo",
      revisions: create_runtime_revisions(5),
      total_item_count: 3,
      quality: create_quality_state(),
      sourceLanguage: "JA",
      targetLanguage: "ZH",
      upsertItems: [
        create_runtime_item({
          item_id: 9,
          dst: "゛゜・ー･",
        }),
        create_runtime_item({
          item_id: 10,
          dst: "かな",
        }),
        create_runtime_item({
          item_id: 11,
          dst: "plain",
        }),
      ],
    });

    const list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    const warning_by_row_id = new Map(
      list_view.window_rows.map((item) => {
        return [item.row_id, item.item.warnings];
      }),
    );
    const item_by_row_id = new Map(
      list_view.window_rows.map((item) => {
        return [item.row_id, item.item];
      }),
    );
    expect(warning_by_row_id.get("9")).toEqual([]);
    expect(warning_by_row_id.get("10")).toEqual(["KANA"]);
    expect(warning_by_row_id.get("11")).toEqual([]);
    expect(item_by_row_id.get("10")?.warning_fragments_by_code.KANA).toEqual(["かな"]);

    const english_engine = createProofreadingUiWorkerService();
    const english_sync_state = english_engine.hydrate_full({
      projectId: "demo",
      revisions: create_runtime_revisions(6),
      total_item_count: 1,
      quality: create_quality_state(),
      sourceLanguage: "EN",
      targetLanguage: "ZH",
      upsertItems: [
        create_runtime_item({
          item_id: 12,
          dst: "かな",
        }),
      ],
    });
    const english_list_view = english_engine.build_list_view({
      filters: english_sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(english_list_view.window_rows[0]?.item.warnings).toEqual([]);
    expect(english_list_view.window_rows[0]?.item.warning_fragments_by_code).toEqual({});
  });

  it("谚文残留只在韩文源语言检查", () => {
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full({
      projectId: "demo",
      revisions: create_runtime_revisions(7),
      total_item_count: 1,
      quality: create_quality_state(),
      sourceLanguage: "KO",
      targetLanguage: "ZH",
      upsertItems: [
        create_runtime_item({
          item_id: 13,
          dst: "번역",
        }),
      ],
    });

    const list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.window_rows[0]?.item.warnings).toEqual(["HANGEUL"]);
    expect(list_view.window_rows[0]?.item.warning_fragments_by_code.HANGEUL).toEqual(["번역"]);
  });

  it("中文目标下日韩相似度必须伴随对应残留，残留 warning 仍独立展示", () => {
    const ja_engine = createProofreadingUiWorkerService();
    const ja_sync_state = ja_engine.hydrate_full({
      projectId: "demo",
      revisions: create_runtime_revisions(8),
      total_item_count: 2,
      quality: create_quality_state(),
      sourceLanguage: "JA",
      targetLanguage: "ZH",
      upsertItems: [
        create_runtime_item({
          item_id: 14,
          src: "東京",
          dst: "東京",
        }),
        create_runtime_item({
          item_id: 15,
          src: "東京",
          dst: "東京あ",
        }),
      ],
    });
    const ja_list_view = ja_engine.build_list_view({
      filters: ja_sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(ja_list_view.window_rows[0]?.item.warnings).toEqual([]);
    expect(ja_list_view.window_rows[1]?.item.warnings).toEqual(["KANA", "SIMILARITY"]);

    const ko_engine = createProofreadingUiWorkerService();
    const ko_sync_state = ko_engine.hydrate_full({
      projectId: "demo",
      revisions: create_runtime_revisions(9),
      total_item_count: 2,
      quality: create_quality_state(),
      sourceLanguage: "KO",
      targetLanguage: "ZH",
      upsertItems: [
        create_runtime_item({
          item_id: 16,
          src: "韓國",
          dst: "韓國",
        }),
        create_runtime_item({
          item_id: 17,
          src: "韓國",
          dst: "韓國한",
        }),
      ],
    });
    const ko_list_view = ko_engine.build_list_view({
      filters: ko_sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(ko_list_view.window_rows[0]?.item.warnings).toEqual([]);
    expect(ko_list_view.window_rows[1]?.item.warnings).toEqual(["HANGEUL", "SIMILARITY"]);
  });

  it("空译文会跳过检查，文本保护按非空保护段的顺序和值比较", () => {
    const quality = {
      ...create_quality_state(),
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [
          {
            src: "\\{[^}]+\\}",
            dst: "",
          },
        ],
      },
    };
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full({
      projectId: "demo",
      revisions: create_runtime_revisions(8),
      total_item_count: 3,
      quality,
      sourceLanguage: "EN",
      targetLanguage: "ZH",
      upsertItems: [
        create_runtime_item({
          item_id: 14,
          src: "Hello {name}",
          dst: "",
        }),
        create_runtime_item({
          item_id: 15,
          src: "Hello {a}{b}",
          dst: "Bonjour {b}{a}",
        }),
        create_runtime_item({
          item_id: 16,
          src: "Hello {a}{b}",
          dst: "Bonjour {a}{b}",
        }),
      ],
    });

    const list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.window_rows[0]?.item.warnings).toEqual([]);
    expect(list_view.window_rows[1]?.item.warnings).toEqual(["TEXT_PRESERVE"]);
    expect(list_view.window_rows[1]?.item.warning_fragments_by_code.TEXT_PRESERVE).toEqual([
      "{a}",
      "{b}",
    ]);
    expect(list_view.window_rows[2]?.item.warnings).toEqual([]);
  });

  it("相似度会先剥离保护段并在任一侧为空时跳过", () => {
    const quality = {
      ...create_quality_state(),
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 2,
        entries: [
          {
            src: "<[^>]+>",
            dst: "",
          },
        ],
      },
    };
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full({
      projectId: "demo",
      revisions: create_runtime_revisions(9),
      total_item_count: 3,
      quality,
      sourceLanguage: "EN",
      targetLanguage: "ZH",
      upsertItems: [
        create_runtime_item({
          item_id: 17,
          src: "<tag>",
          dst: "<tag> translated",
        }),
        create_runtime_item({
          item_id: 18,
          src: "alpha",
          dst: "alpha!",
        }),
        create_runtime_item({
          item_id: 19,
          src: "abc",
          dst: "xyz",
        }),
      ],
    });

    const list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.window_rows[0]?.item.warnings).toEqual([]);
    expect(list_view.window_rows[1]?.item.warnings).toEqual(["SIMILARITY"]);
    expect(list_view.window_rows[2]?.item.warnings).toEqual([]);
  });

  it("重试次数达到 2 次时才产生阈值警告", () => {
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full({
      projectId: "demo",
      revisions: create_runtime_revisions(10),
      total_item_count: 2,
      quality: create_quality_state(),
      sourceLanguage: "EN",
      targetLanguage: "ZH",
      upsertItems: [
        create_runtime_item({
          item_id: 20,
          retry_count: 1,
        }),
        create_runtime_item({
          item_id: 21,
          retry_count: 2,
        }),
      ],
    });

    const list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.window_rows[0]?.item.warnings).toEqual([]);
    expect(list_view.window_rows[1]?.item.warnings).toEqual(["RETRY_THRESHOLD"]);
  });

  it("术语 miss 使用替换后的文本、保留 src 空白，并把空译文视为已包含", () => {
    const quality = {
      ...create_quality_state(),
      glossary: {
        enabled: true,
        mode: "off",
        revision: 2,
        entries: [
          {
            src: " foo ",
            dst: "bar",
          },
          {
            src: "empty",
            dst: "",
          },
        ],
      },
      pre_replacement: {
        enabled: true,
        mode: "off",
        revision: 1,
        entries: [
          {
            src: "token",
            dst: " foo ",
          },
        ],
      },
      post_replacement: {
        enabled: true,
        mode: "off",
        revision: 1,
        entries: [
          {
            src: "bar",
            dst: "visible",
          },
        ],
      },
    };
    const engine = createProofreadingUiWorkerService();
    const sync_state = engine.hydrate_full({
      projectId: "demo",
      revisions: create_runtime_revisions(11),
      total_item_count: 4,
      quality,
      sourceLanguage: "EN",
      targetLanguage: "ZH",
      upsertItems: [
        create_runtime_item({
          item_id: 22,
          src: "token",
          dst: "missing",
        }),
        create_runtime_item({
          item_id: 23,
          src: "token",
          dst: "visible",
        }),
        create_runtime_item({
          item_id: 24,
          src: "foo",
          dst: "missing",
        }),
        create_runtime_item({
          item_id: 25,
          src: "empty",
          dst: "translated",
        }),
      ],
    });

    const list_view = engine.build_list_view({
      filters: sync_state.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.window_rows[0]?.item.failed_glossary_terms).toEqual([[" foo ", "bar"]]);
    expect(list_view.window_rows[0]?.item.warnings).toEqual(["GLOSSARY"]);
    expect(list_view.window_rows[1]?.item.failed_glossary_terms).toEqual([]);
    expect(list_view.window_rows[2]?.item.failed_glossary_terms).toEqual([]);
    expect(list_view.window_rows[3]?.item.failed_glossary_terms).toEqual([]);
  });
});

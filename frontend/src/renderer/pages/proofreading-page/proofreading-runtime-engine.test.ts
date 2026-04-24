import { describe, expect, it } from "vitest";

import { createProofreadingRuntimeEngine } from "./proofreading-runtime-engine";
import { PROOFREADING_STATUS_ORDER, PROOFREADING_WARNING_CODES } from "./types";

const ALL_STATUS_FILTERS = [...PROOFREADING_STATUS_ORDER];
const DEFAULT_STATUS_FILTERS = ["NONE", "PROCESSING", "PROCESSED", "ERROR"];

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
  overrides: Partial<ReturnType<typeof create_hydration_input>["items"][number]>,
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
    project_id: "demo",
    revision: 3,
    total_item_count: 2,
    quality: create_quality_state(),
    source_language: "JA",
    items: [
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
    project_id: "demo",
    revision: 4,
    total_item_count: 6,
    quality: create_quality_state(),
    source_language: "JA",
    items: [
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

describe("createProofreadingRuntimeEngine", () => {
  it("hydrate_full 后列表、默认筛选与筛选面板会基于 worker 缓存一致产出", () => {
    const engine = createProofreadingRuntimeEngine();

    const sync_state = engine.hydrate_full(create_hydration_input());
    expect(sync_state).toMatchObject({
      revision: 3,
      project_id: "demo",
      total_item_count: 2,
      review_item_count: 2,
      warning_item_count: 1,
      default_filters: {
        warning_types: [...PROOFREADING_WARNING_CODES],
        statuses: DEFAULT_STATUS_FILTERS,
        file_paths: ["a.txt", "b.txt"],
        glossary_terms: [["foo", "baz"]],
      },
    });

    const list_view = engine.build_list_view({
      filters: sync_state.default_filters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view).toMatchObject({
      revision: 3,
      project_id: "demo",
      summary: {
        total_items: 2,
        filtered_items: 2,
        warning_items: 1,
      },
    });
    expect(list_view.items.map((item) => item.row_id)).toEqual(["1", "2"]);
    expect(list_view.items[0]?.item.failed_glossary_terms).toEqual([["foo", "baz"]]);

    const filter_panel = engine.build_filter_panel({
      filters: sync_state.default_filters,
    });
    expect(filter_panel.filters.warning_types).toEqual([...PROOFREADING_WARNING_CODES]);
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

  it("apply_item_delta 只更新变更条目与相关计数，不回退整页重建结果", () => {
    const engine = createProofreadingRuntimeEngine();
    const sync_state = engine.hydrate_full(create_hydration_input());

    const delta_state = engine.apply_item_delta({
      project_id: "demo",
      revision: 4,
      total_item_count: 2,
      items: [
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
    });

    expect(delta_state).toMatchObject({
      revision: 4,
      project_id: "demo",
      total_item_count: 2,
      review_item_count: 2,
      warning_item_count: 0,
      default_filters: {
        warning_types: [...PROOFREADING_WARNING_CODES],
        statuses: DEFAULT_STATUS_FILTERS,
        file_paths: ["a.txt", "b.txt"],
        glossary_terms: [],
      },
    });

    const list_view = engine.build_list_view({
      filters: sync_state.default_filters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.summary).toMatchObject({
      total_items: 2,
      filtered_items: 2,
      warning_items: 0,
    });
    expect(list_view.items[0]?.item.dst).toBe("baz");
    expect(list_view.items[0]?.item.failed_glossary_terms).toEqual([]);
    expect(list_view.items[1]?.item.dst).toBe("beta");

    const filter_panel = engine.build_filter_panel({
      filters: delta_state.default_filters,
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

  it("跳过 warning 的状态仍进入筛选源并计为无警告", () => {
    const engine = createProofreadingRuntimeEngine();

    const sync_state = engine.hydrate_full(create_skipped_status_hydration_input());
    expect(sync_state.review_item_count).toBe(6);
    expect(sync_state.warning_item_count).toBe(0);
    expect(sync_state.default_filters.statuses).toEqual(DEFAULT_STATUS_FILTERS);

    const filter_panel = engine.build_filter_panel({
      filters: sync_state.default_filters,
    });
    expect(filter_panel.filters.statuses).toEqual(DEFAULT_STATUS_FILTERS);
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
        ...sync_state.default_filters,
        statuses: ALL_STATUS_FILTERS,
      },
    });
    expect(all_status_filter_panel.warning_count_by_code).toMatchObject({
      NO_WARNING: 6,
    });

    const list_view = engine.build_list_view({
      filters: sync_state.default_filters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.items.map((item) => item.row_id)).toEqual(["7", "8"]);

    const all_status_list_view = engine.build_list_view({
      filters: {
        ...sync_state.default_filters,
        statuses: ALL_STATUS_FILTERS,
      },
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(all_status_list_view.items.map((item) => item.row_id)).toEqual([
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
  });

  it("假名残留只在日文源语言检查，并排除 TextBase 中的假名符号例外", () => {
    const engine = createProofreadingRuntimeEngine();
    const sync_state = engine.hydrate_full({
      project_id: "demo",
      revision: 5,
      total_item_count: 3,
      quality: create_quality_state(),
      source_language: "JA",
      items: [
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
      filters: sync_state.default_filters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    const warning_by_row_id = new Map(
      list_view.items.map((item) => {
        return [item.row_id, item.item.warnings];
      }),
    );
    const item_by_row_id = new Map(
      list_view.items.map((item) => {
        return [item.row_id, item.item];
      }),
    );
    expect(warning_by_row_id.get("9")).toEqual([]);
    expect(warning_by_row_id.get("10")).toEqual(["KANA"]);
    expect(warning_by_row_id.get("11")).toEqual([]);
    expect(item_by_row_id.get("10")?.warning_fragments_by_code.KANA).toEqual(["かな"]);

    const english_engine = createProofreadingRuntimeEngine();
    const english_sync_state = english_engine.hydrate_full({
      project_id: "demo",
      revision: 6,
      total_item_count: 1,
      quality: create_quality_state(),
      source_language: "EN",
      items: [
        create_runtime_item({
          item_id: 12,
          dst: "かな",
        }),
      ],
    });
    const english_list_view = english_engine.build_list_view({
      filters: english_sync_state.default_filters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(english_list_view.items[0]?.item.warnings).toEqual([]);
    expect(english_list_view.items[0]?.item.warning_fragments_by_code).toEqual({});
  });

  it("谚文残留只在韩文源语言检查", () => {
    const engine = createProofreadingRuntimeEngine();
    const sync_state = engine.hydrate_full({
      project_id: "demo",
      revision: 7,
      total_item_count: 1,
      quality: create_quality_state(),
      source_language: "KO",
      items: [
        create_runtime_item({
          item_id: 13,
          dst: "번역",
        }),
      ],
    });

    const list_view = engine.build_list_view({
      filters: sync_state.default_filters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.items[0]?.item.warnings).toEqual(["HANGEUL"]);
    expect(list_view.items[0]?.item.warning_fragments_by_code.HANGEUL).toEqual(["번역"]);
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
    const engine = createProofreadingRuntimeEngine();
    const sync_state = engine.hydrate_full({
      project_id: "demo",
      revision: 8,
      total_item_count: 3,
      quality,
      source_language: "EN",
      items: [
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
      filters: sync_state.default_filters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.items[0]?.item.warnings).toEqual([]);
    expect(list_view.items[1]?.item.warnings).toEqual(["TEXT_PRESERVE"]);
    expect(list_view.items[1]?.item.warning_fragments_by_code.TEXT_PRESERVE).toEqual([
      "{a}",
      "{b}",
    ]);
    expect(list_view.items[2]?.item.warnings).toEqual([]);
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
    const engine = createProofreadingRuntimeEngine();
    const sync_state = engine.hydrate_full({
      project_id: "demo",
      revision: 9,
      total_item_count: 3,
      quality,
      source_language: "EN",
      items: [
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
      filters: sync_state.default_filters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.items[0]?.item.warnings).toEqual([]);
    expect(list_view.items[1]?.item.warnings).toEqual(["SIMILARITY"]);
    expect(list_view.items[2]?.item.warnings).toEqual([]);
  });

  it("重试次数达到 2 次时才产生阈值警告", () => {
    const engine = createProofreadingRuntimeEngine();
    const sync_state = engine.hydrate_full({
      project_id: "demo",
      revision: 10,
      total_item_count: 2,
      quality: create_quality_state(),
      source_language: "EN",
      items: [
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
      filters: sync_state.default_filters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.items[0]?.item.warnings).toEqual([]);
    expect(list_view.items[1]?.item.warnings).toEqual(["RETRY_THRESHOLD"]);
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
    const engine = createProofreadingRuntimeEngine();
    const sync_state = engine.hydrate_full({
      project_id: "demo",
      revision: 11,
      total_item_count: 4,
      quality,
      source_language: "EN",
      items: [
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
      filters: sync_state.default_filters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    expect(list_view.items[0]?.item.failed_glossary_terms).toEqual([[" foo ", "bar"]]);
    expect(list_view.items[0]?.item.warnings).toEqual(["GLOSSARY"]);
    expect(list_view.items[1]?.item.failed_glossary_terms).toEqual([]);
    expect(list_view.items[2]?.item.failed_glossary_terms).toEqual([]);
    expect(list_view.items[3]?.item.failed_glossary_terms).toEqual([]);
  });
});

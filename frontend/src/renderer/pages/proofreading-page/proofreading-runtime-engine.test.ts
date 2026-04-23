import { describe, expect, it } from "vitest";

import { createProofreadingRuntimeEngine } from "./proofreading-runtime-engine";

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
        statuses: ["NONE", "PROCESSED"],
        file_paths: ["a.txt", "b.txt"],
        glossary_terms: [["foo", "baz"]],
      },
    });
    expect(sync_state.default_filters.warning_types).toEqual(
      expect.arrayContaining(["NO_WARNING", "GLOSSARY"]),
    );

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
        file_paths: ["a.txt", "b.txt"],
        glossary_terms: [],
      },
    });
    expect(delta_state.default_filters.warning_types).toEqual(["NO_WARNING"]);

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
    expect(filter_panel.glossary_term_entries).toEqual([]);
    expect(filter_panel.without_glossary_miss_count).toBe(2);
  });
});

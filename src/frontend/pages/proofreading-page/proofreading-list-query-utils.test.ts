import { describe, expect, it } from "vitest";

import {
  clone_proofreading_view_filter_state,
  create_empty_filter_options,
  create_empty_proofreading_view_filter_state,
  create_proofreading_view_filter_state,
  create_selected_proofreading_filter_selection,
} from "@frontend/pages/proofreading-page/proofreading-filter-state";
import {
  PROOFREADING_INITIAL_WINDOW_ROWS,
  build_filter_panel_signature,
  build_proofreading_list_query_intent_key,
  build_refreshed_proofreading_list_view,
  is_missing_refreshed_list_window,
  resolve_list_view_window_bounds,
  resolve_prefetched_list_window_bounds,
  resolve_proofreading_refresh_signal,
  resolve_requested_sync_mode,
} from "@frontend/pages/proofreading-page/proofreading-list-query-utils";
import {
  create_empty_proofreading_list_view,
  type ProofreadingFilterOptions,
} from "@shared/proofreading/proofreading-types";

// 构造具备稳定身份的旧视图，供窗口复用与失效判定共享。
function create_list_view(row_count = 3) {
  return {
    ...create_empty_proofreading_list_view(),
    projectId: "E:/demo/sample.lg",
    revisions: {
      files: 1,
      items: 7,
      quality: 2,
      proofreading: 3,
    },
    view_id: "view-1",
    row_count,
    window_start: 1,
  };
}

// 构造完整筛选值，避免签名测试遗漏未关注的维度。
function create_filters(patch: Partial<ProofreadingFilterOptions> = {}): ProofreadingFilterOptions {
  return {
    warning_types: ["NO_WARNING"],
    statuses: ["NONE", "PROCESSED"],
    file_paths: ["chapter01.txt"],
    glossary_terms: [["魔法", "Magic"]],
    include_without_glossary_miss: true,
    ...patch,
  };
}

describe("proofreading-list-query-utils", () => {
  it("可见范围会扩成预取窗口并限制在稳定视图行数内", () => {
    expect(
      resolve_prefetched_list_window_bounds({
        range: { start: 300, count: 10 },
        row_count: 1000,
      }),
    ).toEqual({
      start: 44,
      count: 522,
    });
    expect(
      resolve_prefetched_list_window_bounds({
        range: { start: 990, count: 10 },
        row_count: 1000,
      }),
    ).toEqual({
      start: 734,
      count: 266,
    });
  });

  it("delta 窗口会更新旧视图内容和 revision 并保留 view_id", () => {
    const previous_view = create_list_view();
    const refreshed_view = build_refreshed_proofreading_list_view({
      previous_view,
      sync_state: {
        projectId: "E:/demo/sample.lg",
        sourceLanguage: "JA",
        targetLanguage: "ZH",
        revisions: {
          files: 1,
          items: 8,
          quality: 2,
          proofreading: 4,
        },
        defaultFilters: create_empty_filter_options(),
      },
      window: {
        view_id: "view-1",
        start: 0,
        row_count: 2,
        rows: [],
      },
    });

    expect(refreshed_view).toMatchObject({
      view_id: "view-1",
      row_count: 2,
      window_start: 0,
      revisions: {
        files: 1,
        items: 8,
        quality: 2,
        proofreading: 4,
      },
    });
    expect(resolve_list_view_window_bounds(refreshed_view)).toEqual({
      start: 0,
      count: PROOFREADING_INITIAL_WINDOW_ROWS,
    });
  });

  it("只有非空旧视图读到完全空窗口时才判定 view_id 失效", () => {
    const empty_window = {
      view_id: "view-1",
      start: 0,
      row_count: 0,
      rows: [],
    };

    expect(
      is_missing_refreshed_list_window({
        previous_view: create_list_view(),
        window: empty_window,
      }),
    ).toBe(true);
    expect(
      is_missing_refreshed_list_window({
        previous_view: create_list_view(0),
        window: empty_window,
      }),
    ).toBe(false);
  });

  it("查询意图键忽略对象引用，但区分搜索、排序和显式筛选", () => {
    const default_filter_state = create_empty_proofreading_view_filter_state();
    const default_key = build_proofreading_list_query_intent_key({
      filter_state: default_filter_state,
      sort_state: null,
    });

    expect(
      build_proofreading_list_query_intent_key({
        filter_state: clone_proofreading_view_filter_state(default_filter_state),
        sort_state: null,
      }),
    ).toBe(default_key);
    expect(
      build_proofreading_list_query_intent_key({
        filter_state: create_proofreading_view_filter_state({
          ...default_filter_state,
          search_keyword: "foo",
        }),
        sort_state: null,
      }),
    ).not.toBe(default_key);
    expect(
      build_proofreading_list_query_intent_key({
        filter_state: default_filter_state,
        sort_state: {
          column_id: "src",
          direction: "ascending",
        },
      }),
    ).not.toBe(default_key);
    expect(
      build_proofreading_list_query_intent_key({
        filter_state: create_proofreading_view_filter_state({
          ...default_filter_state,
          selection: create_selected_proofreading_filter_selection(create_empty_filter_options()),
        }),
        sort_state: null,
      }),
    ).not.toBe(default_key);
  });

  it("筛选面板签名忽略集合顺序但跟随 revision", () => {
    const filters = create_filters();
    const revisions = {
      items: 7,
      quality: 2,
      proofreading: 3,
    };
    const signature = build_filter_panel_signature({
      revisions,
      filters,
    });

    expect(
      build_filter_panel_signature({
        revisions,
        filters: create_filters({
          statuses: [...filters.statuses].reverse(),
        }),
      }),
    ).toBe(signature);
    expect(
      build_filter_panel_signature({
        revisions: {
          ...revisions,
          items: 8,
        },
        filters,
      }),
    ).not.toBe(signature);
  });

  it("缓存身份变化强制全量同步，稳定身份沿用事件模式", () => {
    const sync_state = {
      projectId: "E:/demo/sample.lg",
      sourceLanguage: "JA",
      targetLanguage: "ZH",
      revisions: {
        files: 1,
        items: 7,
        quality: 2,
        proofreading: 3,
      },
      defaultFilters: create_empty_filter_options(),
    };
    const base_args = {
      cache_status: "ready" as const,
      sync_state,
      project_path: sync_state.projectId,
      sourceLanguage: sync_state.sourceLanguage,
      targetLanguage: sync_state.targetLanguage,
      signal_mode: "delta" as const,
    };

    expect(resolve_requested_sync_mode(base_args)).toBe("delta");
    expect(
      resolve_requested_sync_mode({
        ...base_args,
        project_path: "E:/demo/another.lg",
      }),
    ).toBe("full");
    expect(
      resolve_requested_sync_mode({
        ...base_args,
        targetLanguage: "EN",
      }),
    ).toBe("full");
    expect(
      resolve_requested_sync_mode({
        ...base_args,
        cache_status: "error",
      }),
    ).toBe("full");
  });

  it("只有精确行级 items 事件生成 delta，并规范化条目 id", () => {
    expect(
      resolve_proofreading_refresh_signal({
        seq: 1,
        updated_sections: ["items"],
        results: [
          {
            itemDelta: {
              upsertItemIds: ["2", 2, 0, "invalid"],
              deleteItemIds: [3, "3"],
              fullReplace: false,
            },
          },
        ],
      }),
    ).toEqual({
      seq: 1,
      mode: "delta",
      itemIds: [2],
      deleteItemIds: [3],
    });
    expect(
      resolve_proofreading_refresh_signal({
        seq: 2,
        updated_sections: ["items"],
        results: [],
      }),
    ).toEqual({
      seq: 2,
      mode: "full",
      itemIds: [],
      deleteItemIds: [],
    });
  });

  it("仅校对状态变化为 noop，质量变化为 full，无关 section 不刷新", () => {
    expect(
      resolve_proofreading_refresh_signal({
        seq: 1,
        updated_sections: ["proofreading"],
        results: [],
      }),
    ).toEqual({
      seq: 1,
      mode: "noop",
      itemIds: [],
      deleteItemIds: [],
    });
    expect(
      resolve_proofreading_refresh_signal({
        seq: 2,
        updated_sections: ["quality"],
        results: [],
      })?.mode,
    ).toBe("full");
    expect(
      resolve_proofreading_refresh_signal({
        seq: 3,
        updated_sections: ["prompts"],
        results: [],
      }),
    ).toBeNull();
  });
});

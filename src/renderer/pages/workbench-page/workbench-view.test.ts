import { describe, expect, it } from "vitest";
import type { ProjectItemPublicRecord } from "@base/item";

import {
  applyWorkbenchItemsDeltaToCache,
  createWorkbenchViewCache,
  getWorkbenchViewCache,
} from "@/pages/workbench-page/workbench-view";
import { createProjectItemIndex } from "@/project/store/project-item-index";

function create_test_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

function create_test_item_index(
  items: Record<string, Partial<ProjectItemPublicRecord>>,
): ReturnType<typeof createProjectItemIndex> {
  return createProjectItemIndex(
    Object.fromEntries(
      Object.entries(items).map(([item_id, item]) => {
        return [
          item_id,
          create_test_item({
            item_id: Number(item_id),
            ...item,
          }),
        ];
      }),
    ),
  );
}

describe("createWorkbenchViewCache", () => {
  it("会保持文件排序并一次遍历聚合工作台统计", () => {
    const snapshot = createWorkbenchViewCache({
      files: {
        "chapter02.txt": {
          rel_path: "chapter02.txt",
          file_type: "TXT",
          sort_index: 2,
        },
        "chapter01.txt": {
          rel_path: "chapter01.txt",
          file_type: "TXT",
          sort_index: 1,
        },
        "chapter03.txt": {
          rel_path: "chapter03.txt",
          file_type: "TXT",
          sort_index: 2,
        },
        "empty.txt": {
          rel_path: "empty.txt",
          file_type: "TXT",
          sort_index: 3,
        },
      },
      items: create_test_item_index({
        "1": {
          file_path: "chapter02.txt",
          src: "done",
          status: "EXCLUDED",
        },
        "2": {
          file_path: "chapter01.txt",
          src: "processed 1",
          status: "PROCESSED",
        },
        "3": {
          file_path: "chapter01.txt",
          src: "processed 2",
          status: "PROCESSED",
        },
        "4": {
          file_path: "chapter03.txt",
          src: "error",
          status: "ERROR",
        },
        "5": {
          file_path: "missing.txt",
          src: "pending",
          status: "NONE",
        },
        "6": {
          file_path: "chapter03.txt",
          src: "rule skipped",
          status: "RULE_SKIPPED",
        },
        "7": {
          file_path: "chapter03.txt",
          src: "language skipped",
          status: "LANGUAGE_SKIPPED",
        },
      }),
      analysis: {
        status_summary: {
          total_line: 5,
          processed_line: 1,
          error_line: 2,
          line: 3,
        },
      },
    }).snapshot;

    expect(snapshot.entries).toEqual([
      {
        rel_path: "chapter01.txt",
        file_type: "TXT",
        item_count: 2,
      },
      {
        rel_path: "chapter02.txt",
        file_type: "TXT",
        item_count: 1,
      },
      {
        rel_path: "chapter03.txt",
        file_type: "TXT",
        item_count: 3,
      },
      {
        rel_path: "empty.txt",
        file_type: "TXT",
        item_count: 0,
      },
    ]);
    expect(snapshot).toMatchObject({
      file_count: 4,
      total_items: 7,
      translation_stats: {
        total_items: 7,
        completed_count: 2,
        failed_count: 1,
        pending_count: 1,
        skipped_count: 3,
        completion_percent: (5 / 7) * 100,
      },
      analysis_stats: {
        total_items: 7,
        completed_count: 1,
        failed_count: 2,
        pending_count: 2,
        skipped_count: 2,
        completion_percent: (3 / 7) * 100,
      },
    });
  });

  it("items 增量缓存会只更新变更条目的文件计数和翻译统计", () => {
    const base_state = {
      files: {
        "chapter01.txt": {
          rel_path: "chapter01.txt",
          file_type: "TXT",
          sort_index: 1,
        },
        "chapter02.txt": {
          rel_path: "chapter02.txt",
          file_type: "TXT",
          sort_index: 2,
        },
      },
      items: create_test_item_index({
        "1": {
          file_path: "chapter01.txt",
          src: "a",
          status: "NONE",
        },
        "2": {
          file_path: "chapter01.txt",
          src: "b",
          status: "PROCESSED",
        },
      }),
      analysis: {
        status_summary: {
          total_line: 2,
          processed_line: 0,
          error_line: 0,
        },
      },
    };
    const cache = createWorkbenchViewCache(base_state);

    const next_cache = applyWorkbenchItemsDeltaToCache({
      cache,
      state: {
        ...base_state,
        items: create_test_item_index({
          ...base_state.items.toRecordSnapshot(),
          "1": {
            file_path: "chapter02.txt",
            src: "a",
            status: "PROCESSED",
          },
        }),
      },
      item_ids: [1],
    });

    expect(next_cache).toBe(cache);
    expect(next_cache?.snapshot.entries).toEqual([
      {
        rel_path: "chapter01.txt",
        file_type: "TXT",
        item_count: 1,
      },
      {
        rel_path: "chapter02.txt",
        file_type: "TXT",
        item_count: 1,
      },
    ]);
    expect(next_cache?.snapshot.translation_stats).toMatchObject({
      total_items: 2,
      completed_count: 2,
      pending_count: 0,
    });
  });

  it("缺少 analysis.status_summary 时增量缓存会要求回退全量重建", () => {
    const cache = createWorkbenchViewCache({
      files: {},
      items: create_test_item_index({
        "1": {
          file_path: "chapter01.txt",
          src: "a",
          status: "NONE",
        },
      }),
      analysis: {},
    });

    expect(
      applyWorkbenchItemsDeltaToCache({
        cache,
        state: {
          files: {},
          items: create_test_item_index({
            "1": {
              file_path: "chapter01.txt",
              src: "a",
              status: "PROCESSED",
            },
          }),
          analysis: {},
        },
        item_ids: [1],
      }),
    ).toBeNull();
  });

  it("selector 会按项目路径与 section revision 决定复用、增量或重建", () => {
    const base_state = {
      project: { path: "demo.lg" },
      files: {
        "chapter01.txt": {
          rel_path: "chapter01.txt",
          file_type: "TXT",
          sort_index: 1,
        },
      },
      items: create_test_item_index({
        "1": {
          file_path: "chapter01.txt",
          src: "a",
          status: "NONE",
        },
      }),
      analysis: {
        status_summary: {
          total_line: 1,
          processed_line: 0,
          error_line: 0,
        },
      },
      revisions: { sections: { files: 1, items: 1, analysis: 1 } },
    };
    const base_cache = getWorkbenchViewCache({
      state: base_state,
      previousCache: null,
    });
    const reused_cache = getWorkbenchViewCache({
      state: base_state,
      previousCache: base_cache,
    });
    const delta_cache = getWorkbenchViewCache({
      state: {
        ...base_state,
        items: create_test_item_index({
          ...base_state.items.toRecordSnapshot(),
          "1": {
            file_path: "chapter01.txt",
            src: "a",
            status: "PROCESSED",
          },
        }),
        revisions: { sections: { files: 1, items: 2, analysis: 1 } },
      },
      previousCache: base_cache,
      itemDeltaIds: [1],
    });
    const rebuilt_cache = getWorkbenchViewCache({
      state: {
        ...base_state,
        revisions: { sections: { files: 2, items: 2, analysis: 1 } },
      },
      previousCache: delta_cache,
      itemDeltaIds: [1],
    });

    expect(reused_cache).toBe(base_cache);
    expect(delta_cache.identity).toEqual({
      project_path: "demo.lg",
      files_revision: 1,
      items_revision: 2,
      analysis_revision: 1,
    });
    expect(delta_cache.snapshot.translation_stats.completed_count).toBe(1);
    expect(rebuilt_cache).not.toBe(delta_cache);
    expect(rebuilt_cache.identity.files_revision).toBe(2);
  });
});

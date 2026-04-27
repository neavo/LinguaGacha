import { describe, expect, it } from "vitest";

import {
  applyWorkbenchItemsDeltaToCache,
  buildWorkbenchView,
  createWorkbenchViewCache,
} from "@/pages/workbench-page/workbench-view";

describe("buildWorkbenchView", () => {
  it("会保持文件排序并一次遍历聚合工作台统计", () => {
    const view = buildWorkbenchView({
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
      items: {
        "1": {
          item_id: 1,
          file_path: "chapter02.txt",
          src: "done",
          status: "DONE",
        },
        "2": {
          item_id: 2,
          file_path: "chapter01.txt",
          src: "processed 1",
          status: "PROCESSED",
        },
        "3": {
          item_id: 3,
          file_path: "chapter01.txt",
          src: "processed 2",
          status: "PROCESSED",
        },
        "4": {
          item_id: 4,
          file_path: "chapter03.txt",
          src: "error",
          status: "ERROR",
        },
        "5": {
          item_id: 5,
          file_path: "missing.txt",
          src: "pending",
          status: "NONE",
        },
        "6": {
          item_id: 6,
          file_path: "chapter03.txt",
          src: "rule skipped",
          status: "RULE_SKIPPED",
        },
        "7": {
          item_id: 7,
          file_path: "chapter03.txt",
          src: "language skipped",
          status: "LANGUAGE_SKIPPED",
        },
      },
      analysis: {
        status_summary: {
          total_line: 5,
          processed_line: 1,
          error_line: 2,
          line: 3,
        },
      },
    });

    expect(view.entries).toEqual([
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
    expect(view.summary).toEqual({
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

  it("merge_items 增量缓存会只更新变更条目的文件计数和翻译统计", () => {
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
      items: {
        "1": {
          item_id: 1,
          file_path: "chapter01.txt",
          src: "a",
          status: "NONE",
        },
        "2": {
          item_id: 2,
          file_path: "chapter01.txt",
          src: "b",
          status: "PROCESSED",
        },
      },
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
        items: {
          ...base_state.items,
          "1": {
            item_id: 1,
            file_path: "chapter02.txt",
            src: "a",
            status: "PROCESSED",
          },
        },
      },
      item_ids: [1],
    });

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
      items: {
        "1": {
          item_id: 1,
          file_path: "chapter01.txt",
          src: "a",
          status: "NONE",
        },
      },
      analysis: {},
    });

    expect(
      applyWorkbenchItemsDeltaToCache({
        cache,
        state: {
          files: {},
          items: {
            "1": {
              item_id: 1,
              file_path: "chapter01.txt",
              src: "a",
              status: "PROCESSED",
            },
          },
          analysis: {},
        },
        item_ids: [1],
      }),
    ).toBeNull();
  });
});

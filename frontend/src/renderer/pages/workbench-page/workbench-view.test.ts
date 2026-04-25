import { describe, expect, it } from "vitest";

import { buildWorkbenchView } from "@/pages/workbench-page/workbench-view";

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
});

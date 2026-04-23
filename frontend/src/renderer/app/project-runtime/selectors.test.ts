import { describe, expect, it } from "vitest";

import { buildWorkbenchView } from "@/app/project-runtime/selectors";

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
          status: "DONE",
        },
        "2": {
          item_id: 2,
          file_path: "chapter01.txt",
          status: "PROCESSED",
        },
        "3": {
          item_id: 3,
          file_path: "chapter01.txt",
          status: "PROCESSED_IN_PAST",
        },
        "4": {
          item_id: 4,
          file_path: "chapter03.txt",
          status: "ERROR",
        },
        "5": {
          item_id: 5,
          file_path: "missing.txt",
          status: "NONE",
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
        item_count: 1,
      },
      {
        rel_path: "empty.txt",
        file_type: "TXT",
        item_count: 0,
      },
    ]);
    expect(view.summary).toEqual({
      file_count: 4,
      total_items: 5,
      translated: 3,
      translated_in_past: 1,
      error_count: 1,
    });
  });
});

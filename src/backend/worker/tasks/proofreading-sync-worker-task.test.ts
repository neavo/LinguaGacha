import { describe, expect, it } from "vitest";

import { run_proofreading_sync_worker_task } from "./proofreading-sync-worker-task";

describe("run_proofreading_sync_worker_task", () => {
  it("评估校对同步分片并返回可序列化结果", () => {
    const result = run_proofreading_sync_worker_task({
      projectId: "E:/Project/demo.lg",
      revisions: { files: 1, items: 2, quality: 3, proofreading: 4 },
      total_item_count: 1,
      upsertItems: [
        {
          item_id: 1,
          file_path: "scene.ks",
          file_order: 0,
          row_number: 12,
          src: "HP",
          dst: "HP",
          name_src: "Alice",
          name_dst: "艾丽丝",
          status: "PROCESSED",
          text_type: "NONE",
          retry_count: 0,
        },
      ],
      quality: {
        glossary: { entries: [], enabled: true, mode: "custom", revision: 0 },
        pre_replacement: { entries: [], enabled: true, mode: "custom", revision: 0 },
        post_replacement: { entries: [], enabled: true, mode: "custom", revision: 0 },
        text_preserve: { entries: [], enabled: true, mode: "smart", revision: 0 },
      },
      sourceLanguage: "JA",
      targetLanguage: "ZH",
    });

    expect(result).toMatchObject({
      projectId: "E:/Project/demo.lg",
      revisions: { files: 1, items: 2, quality: 3, proofreading: 4 },
      total_item_count: 1,
      sourceLanguage: "JA",
      targetLanguage: "ZH",
    });
    expect(result.rawItems).toEqual([
      {
        item_id: 1,
        file_path: "scene.ks",
        file_order: 0,
        row_number: 12,
        src: "HP",
        dst: "HP",
        name_src: "Alice",
        name_dst: "艾丽丝",
        status: "PROCESSED",
        text_type: "NONE",
        retry_count: 0,
      },
    ]);
    expect(result.evaluatedItems).toHaveLength(1);
  });
});

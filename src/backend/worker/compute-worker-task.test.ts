import { describe, expect, it } from "vitest";

import { run_compute_worker_task } from "./compute-worker-task";

describe("run_compute_worker_task", () => {
  it("执行校对 sync task 并返回对应项目的评估分片", async () => {
    const result = await run_compute_worker_task({
      type: "proofreading_sync",
      input: {
        projectId: "E:/Project/demo.lg",
        revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
        total_item_count: 1,
        upsertItems: [
          {
            item_id: 1,
            file_path: "script.txt",
            file_order: 0,
            row_number: 1,
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
        processingConfig: {
          source_language: "JA",
          target_language: "ZH",
          clean_ruby: false,
          auto_process_prefix_suffix_preserved_text: true,
        },
      },
    });

    expect(result).toMatchObject({
      projectId: "E:/Project/demo.lg",
      total_item_count: 1,
      sourceLanguage: "JA",
      targetLanguage: "ZH",
    });
    expect(result.rawItems).toHaveLength(1);
    expect(result.evaluatedItems).toHaveLength(1);
  });
});

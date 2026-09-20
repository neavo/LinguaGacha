import { describe, expect, it } from "vitest";

import { run_compute_worker_task } from "./compute-worker-task";

describe("run_compute_worker_task", () => {
  it("校对任务返回条目身份与警告结果", async () => {
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
            internal_file_path: null,
            row_number: 1,
            src: "HP",
            dst: "カナ",
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
        },
      },
    });

    expect(result).toEqual({
      evaluations: [
        {
          item_id: 1,
          evaluation: {
            warnings: ["FOREIGN_CHAR_RESIDUE"],
            warning_fragments_by_code: { FOREIGN_CHAR_RESIDUE: ["カナ"] },
            glossary_applications: [],
          },
        },
      ],
    });
  });
});

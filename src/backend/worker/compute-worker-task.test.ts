import { describe, expect, it } from "vitest";

import { run_compute_worker_task } from "./compute-worker-task";

describe("run_compute_worker_task", () => {
  it("执行繁简转换 task 并返回转换后的条目", async () => {
    const result = await run_compute_worker_task({
      type: "ts_conversion",
      input: {
        items: [
          {
            item_id: 1,
            dst: "鼠标",
            name_dst: "鼠标",
            text_type: "NONE",
          },
        ],
        direction: "s2t",
        convert_name: true,
        preserve_text: false,
        text_preserve_mode: "off",
        text_preserve_entries: [],
      },
    });

    expect(result[0]).toMatchObject({
      item_id: 1,
      dst: "鼠標",
      name_dst: "鼠標",
    });
  });

  it("执行校对 sync task 并只返回可序列化评估分片", async () => {
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
        sourceLanguage: "JA",
        targetLanguage: "ZH",
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

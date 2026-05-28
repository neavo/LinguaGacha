import { describe, expect, it } from "vitest";

import { ProofreadingQueryWorker } from "./proofreading-query-worker";

function create_sync_input() {
  return {
    projectId: "E:/Project/demo.lg",
    revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
    total_item_count: 1,
    sourceLanguage: "JA",
    targetLanguage: "ZH",
    quality: {
      glossary: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "HP", dst: "生命值" }],
      },
      pre_replacement: { enabled: false, mode: "custom", revision: 0, entries: [] },
      post_replacement: { enabled: false, mode: "custom", revision: 0, entries: [] },
      text_preserve: { enabled: false, mode: "off", revision: 0, entries: [] },
    },
    upsertItems: [
      {
        item_id: 1,
        file_path: "script.txt",
        file_order: 0,
        row_number: 1,
        src: "HP",
        dst: "HP",
        status: "PROCESSED",
        text_type: "NONE",
        retry_count: 0,
      },
    ],
  };
}

describe("ProofreadingQueryWorker", () => {
  it("sync 后在 worker 内保留校对模型并响应轻量查询", async () => {
    const worker = new ProofreadingQueryWorker({ execution: { kind: "in_process" } });
    const signal = new AbortController().signal;

    const sync = await worker.syncProofreadingCache("key-1", create_sync_input(), signal);
    const view = await worker.queryProofreadingCache(
      "key-1",
      {
        action: "list",
        query: {
          filters: sync.syncState.defaultFilters,
          keyword: "HP",
          scope: "all",
          is_regex: false,
          sort_state: null,
          window_start: 0,
          window_count: 10,
        },
      },
      signal,
    );
    const rows = await worker.queryProofreadingCache(
      "key-1",
      { action: "items_by_row_ids", query: { row_ids: ["1"] } },
      signal,
    );
    await worker.dispose();

    expect(view).toMatchObject({
      action: "list",
      data: {
        row_count: 1,
      },
    });
    expect(rows).toMatchObject({
      action: "items_by_row_ids",
      data: [expect.objectContaining({ item_id: 1, src: "HP" })],
    });
  });

  it("query key 失配时拒绝读取旧模型，dispose 后可重新同步", async () => {
    const worker = new ProofreadingQueryWorker({ execution: { kind: "in_process" } });
    const signal = new AbortController().signal;

    await worker.syncProofreadingCache("key-1", create_sync_input(), signal);
    await expect(
      worker.queryProofreadingCache("key-2", { action: "sync_state" }, signal),
    ).rejects.toThrow();
    await worker.disposeProofreadingCache({ key: "key-1" });
    await expect(
      worker.queryProofreadingCache("key-1", { action: "sync_state" }, signal),
    ).rejects.toThrow();
    await expect(
      worker.syncProofreadingCache("key-2", create_sync_input(), signal),
    ).resolves.toHaveProperty("syncState.projectId", "E:/Project/demo.lg");

    await worker.dispose();
  });
});

import { describe, expect, it } from "vitest";

import {
  createProofreadingListClient,
  getSharedProofreadingListClient,
  resetSharedProofreadingListClientForTest,
} from "./proofreading-list-client";

describe("proofreading-list-client", () => {
  it("创建本地列表 client 并把 hydrate 与窗口读取委托给列表运行态", async () => {
    const client = createProofreadingListClient();

    const sync_state = await client.hydrate_proofreading_full({
      projectId: "E:/Project/demo.lg",
      revisions: { items: 1, quality: 1, proofreading: 1 },
      total_item_count: 1,
      upsertItems: [
        {
          item_id: 1,
          file_path: "chapter.txt",
          row_number: 1,
          src: "源文",
          dst: "译文",
          status: "PROCESSED",
          text_type: "NONE",
          retry_count: 0,
        },
      ],
      quality: {
        glossary: { entries: [], enabled: false, mode: "custom", revision: 1 },
        pre_replacement: { entries: [], enabled: false, mode: "custom", revision: 1 },
        post_replacement: { entries: [], enabled: false, mode: "custom", revision: 1 },
        text_preserve: { entries: [], enabled: false, mode: "off", revision: 1 },
      },
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
    });

    expect(sync_state).toMatchObject({
      projectId: "E:/Project/demo.lg",
      revisions: { items: 1, quality: 1, proofreading: 1 },
    });

    const view = await client.build_proofreading_list_view({
      filters: {
        ...sync_state.defaultFilters,
        statuses: ["PROCESSED"],
      },
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });

    await expect(
      client.read_proofreading_list_window({
        view_id: view.view_id,
        start: 0,
        count: 10,
      }),
    ).resolves.toMatchObject({
      row_count: 1,
      rows: [expect.objectContaining({ item: expect.objectContaining({ item_id: 1 }) })],
    });
  });

  it("共享 client 可重置为新实例", () => {
    const first_client = getSharedProofreadingListClient();

    resetSharedProofreadingListClientForTest();

    expect(getSharedProofreadingListClient()).not.toBe(first_client);
  });
});

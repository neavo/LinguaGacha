import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import { read_proofreading_items_by_row_ids } from "./proofreading-query";

describe("proofreading-query", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("按 row id 回读校对 mutation 前的当前 item 事实", async () => {
    api_fetch_mock.mockResolvedValue({
      rows: [
        {
          row_id: "7",
          item_id: 7,
          file_path: "chapter.txt",
          row_number: 3,
          src: "原文",
          dst: "译文",
          status: "PROCESSED",
          retry_count: 1,
          warnings: [],
          warning_fragments_by_code: {},
          applied_glossary_terms: [],
          failed_glossary_terms: [],
          compressed_src: "原文",
          compressed_dst: "译文",
        },
      ],
    });

    await expect(read_proofreading_items_by_row_ids(["7"])).resolves.toEqual([
      expect.objectContaining({
        item_id: 7,
        row_id: "7",
        src: "原文",
        dst: "译文",
        status: "PROCESSED",
      }),
    ]);
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/query/proofreading", {
      action: "items_by_row_ids",
      row_ids: ["7"],
    });
  });
});

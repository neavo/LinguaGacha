import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import {
  read_proofreading_items_by_row_ids,
  read_proofreading_runtime_hydration_input,
} from "./proofreading-query";

describe("proofreading-query", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("按 row id 回读校对 mutation 前的当前 item 事实", async () => {
    api_fetch_mock.mockResolvedValue({
      rows: [
        {
          row_id: "7",
          item: {
            item_id: 7,
            file_path: "chapter.txt",
            row_number: 3,
            src: "原文",
            dst: "译文",
            status: "PROCESSED",
            retry_count: 1,
          },
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
      row_ids: ["7"],
    });
  });

  it("把后端运行态快照归一成校对列表 hydrate 输入", async () => {
    api_fetch_mock.mockResolvedValue({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { items: 2, quality: 3, proofreading: 4 },
      runtimeSnapshot: {
        total_item_count: 1,
        quality: { glossary: { entries: [] } },
        items: [
          {
            item_id: 5,
            file_path: "chapter.txt",
            row_number: 8,
            src: "源",
            dst: "",
            status: "NONE",
            text_type: "dialogue",
          },
        ],
      },
    });

    await expect(
      read_proofreading_runtime_hydration_input({
        sourceLanguage: "ja",
        targetLanguage: "zh-CN",
      }),
    ).resolves.toMatchObject({
      projectId: "E:/Project/demo.lg",
      revisions: { items: 2, quality: 3, proofreading: 4 },
      total_item_count: 1,
      upsertItems: [
        {
          item_id: 5,
          file_path: "chapter.txt",
          row_number: 8,
          src: "源",
          text_type: "dialogue",
        },
      ],
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
      section_revisions: { items: 2, quality: 3, proofreading: 4 },
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import { createProofreadingApiClient } from "./proofreading-api-client";

describe("proofreading-api-client", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("创建 API 列表 client 并把 sync、列表与窗口读取委托给 Backend query reader/state", async () => {
    const client = createProofreadingApiClient();
    api_fetch_mock.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
      if (body.action === "sync") {
        return {
          syncState: {
            projectId: "E:/Project/demo.lg",
            sourceLanguage: "ja",
            targetLanguage: "zh-CN",
            revisions: { files: 1, items: 6, quality: 1, proofreading: 1 },
            defaultFilters: {
              warning_types: [],
              statuses: [],
              file_paths: [],
              glossary_terms: [],
              include_without_glossary_miss: true,
            },
          },
          sectionRevisions: {
            items: 6,
            quality: 1,
            proofreading: 1,
            prompts: 3,
          },
        };
      }
      if (body.action === "list") {
        return {
          view: {
            projectId: "E:/Project/demo.lg",
            revisions: { files: 1, items: 1, quality: 1, proofreading: 1 },
            view_id: "view-1",
            row_count: 1,
            window_start: 0,
            window_rows: [],
            invalid_regex_message: null,
          },
        };
      }
      if (body.action === "window") {
        return {
          window: {
            view_id: "view-1",
            start: 0,
            row_count: 1,
            rows: [
              {
                row_id: "1",
                item: {
                  item_id: 1,
                  row_id: "1",
                  file_path: "chapter.txt",
                  row_number: 1,
                  src: "源文",
                  dst: "译文",
                  status: "PROCESSED",
                  retry_count: 0,
                  warnings: [],
                  warning_fragments_by_code: {},
                  applied_glossary_terms: [],
                  failed_glossary_terms: [],
                  compressed_src: "源文",
                  compressed_dst: "译文",
                },
                compressed_src: "源文",
                compressed_dst: "译文",
              },
            ],
          },
        };
      }
      return {};
    });

    const sync_snapshot = await client.sync_proofreading_cache({
      sourceLanguage: "ja",
      targetLanguage: "zh-CN",
    });
    const sync_state = sync_snapshot.syncState;

    expect(sync_snapshot).toMatchObject({
      syncState: {
        projectId: "E:/Project/demo.lg",
        revisions: { files: 1, items: 6, quality: 1, proofreading: 1 },
      },
      sectionRevisions: {
        items: 6,
        quality: 1,
        proofreading: 1,
        prompts: 3,
      },
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
    expect(api_fetch_mock).toHaveBeenNthCalledWith(1, "/api/proofreading/view", {
      action: "sync",
      source_language: "ja",
      target_language: "zh-CN",
    });
    expect(api_fetch_mock).toHaveBeenNthCalledWith(2, "/api/proofreading/view", {
      action: "list",
      query: expect.objectContaining({ scope: "all" }),
    });
    expect(api_fetch_mock).toHaveBeenNthCalledWith(3, "/api/proofreading/view", {
      action: "window",
      view_id: "view-1",
      start: 0,
      count: 10,
    });
  });

  it("每次创建独立页面 API client", () => {
    expect(createProofreadingApiClient()).not.toBe(createProofreadingApiClient());
  });
});

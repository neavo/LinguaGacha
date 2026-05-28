import { describe, expect, it } from "vitest";

import { createProofreadingListService } from "./proofreading-list-service";

function create_quality_state() {
  return {
    glossary: { entries: [], enabled: false, mode: "custom", revision: 1 },
    pre_replacement: { entries: [], enabled: false, mode: "custom", revision: 1 },
    post_replacement: { entries: [], enabled: false, mode: "custom", revision: 1 },
    text_preserve: { entries: [], enabled: false, mode: "off", revision: 1 },
  };
}

describe("proofreading-list-service", () => {
  it("全量 hydrate 后按当前筛选构建列表视图并支持窗口读取", () => {
    const service = createProofreadingListService();

    const sync_state = service.hydrate_full({
      projectId: "E:/Project/demo.lg",
      revisions: { items: 1, quality: 1, proofreading: 1 },
      total_item_count: 2,
      upsertItems: [
        {
          item_id: 1,
          file_path: "chapter-a.txt",
          row_number: 1,
          src: "源文 A",
          dst: "译文 A",
          status: "PROCESSED",
          text_type: "NONE",
          retry_count: 0,
        },
        {
          item_id: 2,
          file_path: "chapter-b.txt",
          row_number: 1,
          src: "源文 B",
          dst: "",
          status: "NONE",
          text_type: "NONE",
          retry_count: 0,
        },
      ],
      quality: create_quality_state(),
      sourceLanguage: "JA",
      targetLanguage: "ZH",
    });

    const view = service.build_list_view({
      filters: {
        ...sync_state.defaultFilters,
        statuses: ["PROCESSED"],
      },
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });

    expect(sync_state).toMatchObject({
      projectId: "E:/Project/demo.lg",
      revisions: { items: 1, quality: 1, proofreading: 1 },
    });
    expect(view.row_count).toBe(1);
    expect(
      service.read_list_window({
        view_id: view.view_id,
        start: 0,
        count: 10,
      }),
    ).toMatchObject({
      row_count: 1,
      rows: [expect.objectContaining({ item: expect.objectContaining({ item_id: 1 }) })],
    });
  });

  it("只释放身份匹配的项目列表运行态", () => {
    const service = createProofreadingListService();
    service.hydrate_full({
      projectId: "E:/Project/demo.lg",
      revisions: { items: 1, quality: 1, proofreading: 1 },
      total_item_count: 0,
      upsertItems: [],
      quality: create_quality_state(),
      sourceLanguage: "JA",
      targetLanguage: "ZH",
    });

    service.dispose_project("E:/Project/other.lg");
    expect(service.read_row_ids_range({ view_id: "missing", start: 0, count: 10 })).toEqual([]);

    service.dispose_project("E:/Project/demo.lg");
    expect(
      service.build_filter_panel({
        filters: {
          warning_types: [],
          statuses: [],
          file_paths: [],
          glossary_terms: [],
          include_without_glossary_miss: true,
        },
      }),
    ).toMatchObject({
      available_statuses: [],
      available_warning_types: [],
    });
  });
});

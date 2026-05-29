import { describe, expect, it, vi } from "vitest";

import type { ProofreadingCache } from "./proofreading-cache";
import { ProjectSessionState } from "../project/project-session";
import { ProofreadingQueryService } from "./proofreading-query-service";

function create_cache(): ProofreadingCache {
  const base_result = {
    projectPath: "E:/Project/demo.lg",
    sectionRevisions: { items: 3, quality: 2, proofreading: 1 },
  };
  return {
    sync: vi.fn(async () => ({
      ...base_result,
      data: {
        projectId: "E:/Project/demo.lg",
        sourceLanguage: "JA",
        targetLanguage: "ZH",
        revisions: { files: 4, items: 3, quality: 2, proofreading: 1 },
        defaultFilters: {
          warning_types: ["GLOSSARY"],
          statuses: ["PROCESSED"],
          file_paths: [],
          glossary_terms: [],
          include_without_glossary_miss: true,
        },
      },
    })),
    list: vi.fn(async () => ({
      ...base_result,
      data: {
        projectId: "E:/Project/demo.lg",
        revisions: { files: 4, items: 3, quality: 2, proofreading: 1 },
        view_id: "view-1",
        row_count: 0,
        window_start: 0,
        window_rows: [],
        invalid_regex_message: null,
      },
    })),
    window: vi.fn(),
    rowIdsRange: vi.fn(),
    rowIndex: vi.fn(),
    itemsByRowIds: vi.fn(async () => ({
      ...base_result,
      data: [{ item_id: 1, src: "原文", dst: "译文" }],
    })),
    filterPanel: vi.fn(),
    disposeProject: vi.fn(),
  } as unknown as ProofreadingCache;
}

describe("ProofreadingQueryService", () => {
  it("把 sync 请求收窄后交给 ProofreadingCache 并保留公开响应形状", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const cache = create_cache();
    const service = new ProofreadingQueryService({ sessionState: session_state, cache });

    const result = await service.read({
      action: "sync",
      source_language: "JA",
      target_language: "ZH",
    });

    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { items: 3, quality: 2, proofreading: 1 },
      syncState: {
        sourceLanguage: "JA",
        targetLanguage: "ZH",
      },
      defaultFilters: {
        warning_types: ["GLOSSARY"],
      },
    });
  });

  it("列表和行回读 action 只返回对应轻量字段", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const cache = create_cache();
    const service = new ProofreadingQueryService({ sessionState: session_state, cache });

    const view = await service.read({ action: "list", query: { keyword: "原文" } });
    const rows = await service.read({ action: "items_by_row_ids", row_ids: ["1"] });

    expect(view).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      view: { view_id: "view-1" },
    });
    expect(rows).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      rows: [{ item_id: 1, src: "原文", dst: "译文" }],
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import type { CacheReadPort } from "../cache/cache-types";
import type { ProjectSessionState } from "../project/project-session";
import type { BackendWorkerClient } from "../worker/worker-client";
import { ToolboxNameFieldExtractionService } from "./toolbox-name-field-extraction-service";

describe("ToolboxNameFieldExtractionService", () => {
  it("从缓存快照构造名称字段提取 worker 输入并返回视图", async () => {
    const source_items = [
      { item_id: 1, name: "Alice", name_src: "Alice", name_dst: "", src: "Alice" },
    ];
    const section_revisions = { items: 2, quality: 4 };
    const worker_result = {
      rows: [{ id: "Alice", src: "Alice", dst: "", context: "Alice", status: "untranslated" }],
      counts: { total: 1, translated: 0, untranslated: 1, error: 0 },
      invalid_regex_message: null,
    };
    const worker_run = vi.fn(async () => worker_result);
    const service = new ToolboxNameFieldExtractionService({
      sessionState: create_loaded_session_state(),
      cache: {
        readSectionRevisions: () => section_revisions,
        items: {
          readItems: () => source_items,
        },
        quality: {
          readBlock: () => ({
            glossary: {
              entries: [{ src: "Alice", dst: "艾丽丝" }],
            },
          }),
        },
      } as unknown as CacheReadPort,
      workerClient: { run: worker_run } as unknown as BackendWorkerClient,
    });

    const result = await service.read({
      filter: { keyword: "Alice", scope: "src", is_regex: true },
      sort: { field: "src", direction: "ascending" },
    });

    expect(worker_run).toHaveBeenCalledWith(
      {
        type: "name_field_extraction",
        input: {
          items: source_items,
          glossary_entries: [{ src: "Alice", dst: "艾丽丝" }],
          filter: { keyword: "Alice", scope: "src", is_regex: true },
          sort: { field: "src", direction: "ascending" },
        },
      },
      expect.any(AbortSignal),
    );
    expect(result).toEqual({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: section_revisions,
      view: worker_result,
      glossary: { entries: [{ src: "Alice", dst: "艾丽丝" }] },
    });
  });
});

function create_loaded_session_state(): ProjectSessionState {
  return {
    snapshot: () => ({ loaded: true, projectPath: "E:/Project/demo.lg" }),
  } as unknown as ProjectSessionState;
}

import { describe, expect, it } from "vitest";

import { read_json_record, type JsonRecord, type JsonValue } from "../../domain/json";
import {
  execute_workspace_method,
  workspace_item,
  WORKSPACE_QUERY_PAGE_MAX,
} from "../../test/agent-workspace-method-support";

describe("workspace.queryItems 发布方法", () => {
  it("组合过滤、NFKC 搜索、分页并返回具名对象", async () => {
    const files = {
      "items/entries.jsonl": [
        workspace_item(1, { src: "Alice", file_path: "a.txt" }),
        workspace_item(2, { src: "Alice", file_path: "a.txt" }),
        workspace_item(3, { src: "Alice", file_path: "a.txt", status: "PROCESSED" }),
      ],
      "items/warnings.jsonl": [
        { item_id: 1, warnings: ["GLOSSARY"], glossary_applications: [{ entry_id: "g-1" }] },
        { item_id: 2, warnings: ["GLOSSARY"], glossary_applications: [{ entry_id: "g-2" }] },
      ],
    } satisfies Record<string, JsonValue>;
    const args = {
      filters: { statuses: ["NONE"], file_paths: ["a.txt"], warning_types: ["GLOSSARY"] },
      search: { keywords: [" ＡＬＩＣＥ ", "alice"], scope: "src" },
      offset: 0,
      limit: 1,
    };

    const result = read_json_record(await execute_workspace_method("query-items", args, files));
    expect(result).toMatchObject({ total_item_count: 2, next_offset: 1 });
    expect(result["items"]).toEqual([
      expect.objectContaining({ item_id: 1, matched_keywords: [" ＡＬＩＣＥ "] }),
    ]);

    const with_warnings = read_json_record(
      await execute_workspace_method("query-items", { ...args, include_warnings: true }, files),
    );
    expect(with_warnings["items"]).toEqual([
      expect.objectContaining({
        item_id: 1,
        warning_evidence: expect.objectContaining({ warnings: ["GLOSSARY"] }),
      }),
    ]);
  });

  it("无警告需求时不读取证据，缺失的可选警告使用 null", async () => {
    const files = {
      "items/entries.jsonl": [workspace_item(1)],
    } satisfies Record<string, JsonValue>;
    const result = read_json_record(await execute_workspace_method("query-items", {}, files));

    expect(result).toMatchObject({ total_item_count: 1 });
    expect(result["items"]).toHaveLength(1);

    const with_warnings = read_json_record(
      await execute_workspace_method(
        "query-items",
        { include_warnings: true, limit: 1 },
        { ...files, "items/warnings.jsonl": [] },
      ),
    );
    expect((with_warnings["items"] as JsonRecord[])[0]).toMatchObject({
      item_id: 1,
      warning_evidence: null,
    });
  });

  it("拒绝空关键词", async () => {
    await expect(
      execute_workspace_method(
        "query-items",
        { search: { keywords: [" "] } },
        { "items/entries.jsonl": [] },
      ),
    ).rejects.toThrow();
  });

  it("拒绝越界分页", async () => {
    await expect(
      execute_workspace_method(
        "query-items",
        { limit: WORKSPACE_QUERY_PAGE_MAX + 1 },
        { "items/entries.jsonl": [] },
      ),
    ).rejects.toThrow();
  });
});

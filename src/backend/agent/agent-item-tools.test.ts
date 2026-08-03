import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import type { ProjectWriteResult } from "../../shared/project-event";
import {
  AGENT_PROOFREADING_UPDATE_SOURCE,
  create_agent_item_tools,
  query_agent_project_items,
} from "./agent-item-tools";

function create_item(item_id: number, overrides: JsonRecord = {}): JsonRecord {
  return {
    item_id,
    src: `原文 ${item_id.toString()}`,
    dst: `译文 ${item_id.toString()}`,
    name_src: null,
    name_dst: null,
    tag: "dialog",
    row_number: item_id,
    file_type: "TXT",
    file_path: "script.txt",
    text_type: "DIALOGUE",
    status: "NONE",
    extra_field: { private: true },
    ...overrides,
  };
}

function create_cache(
  read_items: () => JsonRecord[],
  read_revisions = () => ({ items: 2, proofreading: 3 }),
) {
  return {
    snapshot: () => ({
      projectPath: "test.lg",
      epoch: 1,
      freshness: "fresh" as const,
      sectionRevisions: read_revisions(),
      itemCount: read_items().length,
    }),
    items: {
      readItems: read_items,
      readItem: (item_id: number) =>
        read_items().find((item) => item["item_id"] === item_id) ?? null,
    },
  };
}

describe("Agent 正文工具", () => {
  it("所有工具公开 object 根 schema，并只串行写入口", () => {
    const tools = create_agent_item_tools({
      cache: create_cache(() => []),
      proofreading: {
        update_items_from_agent: async () => ({ accepted: true, changes: [] }),
      },
    });

    expect(tools.map((tool) => tool.parameters)).toEqual([
      expect.objectContaining({ type: "object" }),
      expect.objectContaining({ type: "object" }),
    ]);
    expect(tools.map((tool) => tool.executionMode)).toEqual([undefined, "sequential"]);

    const query_schema = tools[0]?.parameters as {
      anyOf?: Array<{
        additionalProperties?: boolean;
        properties?: Record<string, { const?: unknown; maxItems?: number }>;
      }>;
    };
    const sample_schema = query_schema.anyOf?.find(
      (candidate) => candidate.properties?.["mode"]?.const === "sample",
    );
    expect(sample_schema).toBeUndefined();
  });

  it("page 与 ids 按稳定顺序返回固定窄投影", () => {
    const items = [create_item(2), create_item(1), create_item(3)];
    const cache = create_cache(() => items);

    const page = query_agent_project_items(cache, { mode: "page", limit: 2 });
    expect(page).toMatchObject({ cursor: "2", complete: false, sectionRevisions: { items: 2 } });
    expect((page["items"] as JsonRecord[]).map((item) => item["item_id"])).toEqual([2, 1]);
    expect((page["items"] as JsonRecord[])[0]).not.toHaveProperty("extra_field");

    const ids = query_agent_project_items(cache, { mode: "ids", item_ids: [3, 404, 2] });
    expect((ids["items"] as JsonRecord[]).map((item) => item["item_id"])).toEqual([3, 2]);
    expect(ids["missing_item_ids"]).toEqual([404]);
  });

  it("search 分离完整统计与当前页窄 hit，并按字段命中稳定分页", () => {
    const cache = create_cache(() => [
      create_item(1, {
        src: "Alpha Alpha",
        name_src: "ALPHA",
        dst: "Beta Beta",
        name_dst: ["BETA", "ignored"],
      }),
      create_item(2, { src: "beta", dst: "alpha" }),
    ]);
    const source = query_agent_project_items(cache, {
      mode: "search",
      patterns: ["alpha", "beta"],
      scope: "src",
      limit: 1,
    });
    expect(source).toMatchObject({ cursor: "1", complete: false });
    expect(source["results"]).toMatchObject([
      { pattern: "alpha", total_matches: 3, matched_item_count: 1 },
      { pattern: "beta", total_matches: 1, matched_item_count: 1 },
    ]);
    expect(source["hits"]).toEqual([
      {
        pattern: "alpha",
        item_id: 1,
        field: "src",
        text: "Alpha Alpha",
        file_path: "script.txt",
        row_number: 1,
      },
    ]);
    expect(source["results"]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ contexts: expect.anything() })]),
    );
    expect(source["hits"]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ dst: expect.anything() })]),
    );

    const continuation = query_agent_project_items(cache, {
      mode: "search",
      patterns: ["alpha", "beta"],
      scope: "src",
      cursor: "1",
      limit: 2,
    });
    expect(continuation).toMatchObject({ cursor: null, complete: true });
    expect(continuation["hits"]).toMatchObject([
      { pattern: "alpha", item_id: 1, field: "name_src", text: "ALPHA" },
      { pattern: "beta", item_id: 2, field: "src", text: "beta" },
    ]);

    const destination = query_agent_project_items(cache, {
      mode: "search",
      patterns: ["beta"],
      scope: "dst",
    });
    expect(destination["results"]).toMatchObject([
      { pattern: "beta", total_matches: 3, matched_item_count: 1 },
    ]);
    expect(destination["hits"]).toMatchObject([
      { field: "dst", text: "Beta Beta" },
      { field: "name_dst", text: "BETA" },
    ]);
    const all = query_agent_project_items(cache, {
      mode: "search",
      patterns: ["alpha"],
      scope: "all",
      case_sensitive: true,
    });
    expect(all["results"]).toMatchObject([
      { pattern: "alpha", total_matches: 1, matched_item_count: 1 },
    ]);
    expect(all["hits"]).toMatchObject([{ item_id: 2, field: "dst", text: "alpha" }]);
  });

  it("拒绝非法游标与空字面量", () => {
    const cache = create_cache(() => []);
    for (const cursor of ["bad", "0x10", "1e2", "9007199254740992"]) {
      expect(() => query_agent_project_items(cache, { mode: "page", cursor })).toThrow(
        "cursor 无效",
      );
    }
    expect(() => query_agent_project_items(cache, { mode: "search", patterns: ["   "] })).toThrow(
      "patterns",
    );
  });

  it("批量更新只调用一次领域命令，并按变更顺序返回最新条目", async () => {
    let revisions = { items: 2, proofreading: 3 };
    let items = [create_item(1), create_item(2)];
    const update_items = vi.fn(async (request: JsonRecord): Promise<ProjectWriteResult> => {
      for (const change of request["changes"] as JsonRecord[]) {
        const item = items.find((candidate) => candidate["item_id"] === change["item_id"]);
        if (item !== undefined) Object.assign(item, change);
      }
      revisions = { items: 3, proofreading: 4 };
      return { accepted: true, changes: [] };
    });
    const tools = create_agent_item_tools({
      cache: create_cache(
        () => items,
        () => revisions,
      ),
      proofreading: { update_items_from_agent: update_items },
    });
    const tool = tools.find((candidate) => candidate.name === "update_project_translations");
    if (tool === undefined) throw new Error("缺少 update_project_translations");
    const request = {
      changes: [
        { item_id: 2, name_dst: "二号" },
        { item_id: 1, dst: "一号译文" },
      ],
      expected_section_revisions: { items: 2, proofreading: 3 },
    };

    const result = await tool.execute("update", request, undefined, undefined, undefined as never);
    expect(update_items).toHaveBeenCalledTimes(1);
    expect(update_items).toHaveBeenCalledWith(request, AGENT_PROOFREADING_UPDATE_SOURCE);
    expect(result.details).toMatchObject({
      sectionRevisions: { items: 3, proofreading: 4 },
      items: [
        { item_id: 2, name_dst: "二号" },
        { item_id: 1, dst: "一号译文" },
      ],
    });

    await expect(
      tool.execute(
        "duplicate",
        {
          changes: [
            { item_id: 1, dst: "A" },
            { item_id: 1, name_dst: "B" },
          ],
          expected_section_revisions: revisions,
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("唯一正整数");
    expect(update_items).toHaveBeenCalledTimes(1);
  });
});

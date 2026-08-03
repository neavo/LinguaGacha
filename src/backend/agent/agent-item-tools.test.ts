import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import type { ProjectWriteResult } from "../../shared/project-event";
import {
  AGENT_PROOFREADING_UPDATE_SOURCE,
  create_agent_item_tools,
  query_agent_items,
  type AgentProofreading,
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
    text_type: "NONE",
    status: "NONE",
    retry_count: item_id,
    extra_field: { private: true },
    skip_internal_filter: true,
    ...overrides,
  };
}

function create_cache(
  items: () => JsonRecord[],
  revisions = () => ({ items: 2, proofreading: 3 }),
) {
  return {
    snapshot: () => ({
      projectPath: "test.lg",
      epoch: 1,
      freshness: "fresh" as const,
      sectionRevisions: revisions(),
      itemCount: 0,
    }),
    items: {
      readItems: items,
      readItem: (item_id: number) => items().find((item) => item["item_id"] === item_id) ?? null,
    },
  };
}

function create_proofreading(
  overrides: {
    query_warnings?: AgentProofreading["query"]["query_warnings"];
    update_items_from_agent?: AgentProofreading["commands"]["update_items_from_agent"];
  } = {},
): AgentProofreading {
  return {
    query: {
      query_warnings:
        overrides.query_warnings ??
        vi.fn<AgentProofreading["query"]["query_warnings"]>(async () => ({
          projectPath: "test.lg",
          sectionRevisions: { items: 2, proofreading: 3 },
          data: { total_item_count: 0, items: [], invalid_regex_message: null },
        })),
    },
    commands: {
      update_items_from_agent:
        overrides.update_items_from_agent ??
        vi.fn<AgentProofreading["commands"]["update_items_from_agent"]>(async () => ({
          accepted: true,
          changes: [],
        })),
    },
  };
}

describe("Agent item 工具", () => {
  it("按固定顺序注册两个查询与串行 update_items", () => {
    const tools = create_agent_item_tools({
      cache: create_cache(() => []),
      proofreading: create_proofreading(),
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "query_items",
      "query_warning_items",
      "update_items",
    ]);
    expect(tools.map((tool) => tool.executionMode)).toEqual([undefined, undefined, "sequential"]);
    expect(tools.map((tool) => tool.parameters)).toEqual([
      expect.objectContaining({ type: "object", additionalProperties: false }),
      expect.objectContaining({ type: "object", additionalProperties: false }),
      expect.objectContaining({ type: "object", additionalProperties: false }),
    ]);
    expect(JSON.stringify(tools[1]?.parameters)).not.toContain("NO_WARNING");
  });

  it("组合筛选、统计与分页，并保持 ID 请求顺序和窄投影", () => {
    const values = [
      create_item(2, { status: "PROCESSED", file_path: "a.txt" }),
      create_item(1, { status: "NONE", file_path: "b.txt" }),
      create_item(3, { status: "PROCESSED", file_path: "a.txt" }),
    ];
    let revisions = { items: 1, proofreading: 3 };
    const read_items = vi.fn(() => {
      revisions = { items: 2, proofreading: 3 };
      return values;
    });
    const cache = create_cache(read_items, () => revisions);

    const page = query_agent_items(cache, {
      filters: { statuses: ["PROCESSED"], file_paths: ["a.txt"] },
      limit: 1,
    });
    expect(page).toMatchObject({
      sectionRevisions: { items: 2, proofreading: 3 },
      total_item_count: 2,
      cursor: "1",
      complete: false,
    });
    expect(page["items"]).toMatchObject([{ item_id: 2, retry_count: 2 }]);
    expect((page["items"] as JsonRecord[])[0]).not.toHaveProperty("extra_field");
    expect((page["items"] as JsonRecord[])[0]).not.toHaveProperty("skip_internal_filter");

    const ids = query_agent_items(cache, {
      filters: { item_ids: [3, 404, 2], statuses: ["PROCESSED"] },
    });
    expect((ids["items"] as JsonRecord[]).map((item) => item["item_id"])).toEqual([3, 2]);
    expect(ids).toMatchObject({ total_item_count: 2, missing_item_ids: [404], complete: true });

    const beyond = query_agent_items(cache, { cursor: "99" });
    expect(beyond).toMatchObject({ items: [], cursor: null, complete: true });
  });

  it("按 src/dst/all 搜索正文与姓名，并支持 literal、regex 和大小写", () => {
    const cache = create_cache(() => [
      create_item(1, { src: "Alpha", name_src: "ALICE", dst: "Beta", name_dst: "贝塔" }),
      create_item(2, { src: "beta", dst: "alpha", name_dst: "ALPHA" }),
    ]);

    expect(
      (
        query_agent_items(cache, {
          search: { keyword: "alice", scope: "src" },
        })["items"] as JsonRecord[]
      ).map((item) => item["item_id"]),
    ).toEqual([1]);
    expect(
      (
        query_agent_items(cache, {
          search: { keyword: "^alpha$", scope: "dst", is_regex: true, case_sensitive: true },
        })["items"] as JsonRecord[]
      ).map((item) => item["item_id"]),
    ).toEqual([2]);
    expect(
      (
        query_agent_items(cache, {
          search: { keyword: "beta", scope: "all" },
        })["items"] as JsonRecord[]
      ).map((item) => item["item_id"]),
    ).toEqual([1, 2]);
    expect(() => query_agent_items(cache, { search: { keyword: "(", is_regex: true } })).toThrow();
  });

  it("直接调用边界拒绝空筛选、空搜索、非法游标和未知字段", () => {
    const cache = create_cache(() => []);
    expect(() => query_agent_items(cache, { filters: { item_ids: [] } })).toThrow("item_ids");
    expect(() =>
      query_agent_items(cache, {
        filters: { item_ids: [Number.MAX_SAFE_INTEGER + 1] },
      }),
    ).toThrow("item_ids");
    expect(() => query_agent_items(cache, { search: { keyword: "  " } })).toThrow("keyword");
    for (const cursor of ["", "-1", "0x10", "1e2", "9007199254740992"]) {
      expect(() => query_agent_items(cache, { cursor })).toThrow("cursor 无效");
    }
    expect(() => query_agent_items(cache, { nope: true } as never)).toThrow("未知字段");
  });

  it("query_warning_items 归一查询并返回窄投影、证据与分页身份", async () => {
    const query_warnings = vi.fn<AgentProofreading["query"]["query_warnings"]>(async (query) => ({
      projectPath: "test.lg",
      sectionRevisions: { files: 1, items: 2, quality: 3, proofreading: 4 },
      data: {
        total_item_count: 4,
        items:
          query.offset >= 4
            ? []
            : [
                {
                  item_id: 7,
                  file_path: "script.txt",
                  row_number: 9,
                  src: "HP",
                  dst: "カナ",
                  name_src: ["Alice", "meta"],
                  name_dst: ["艾丽丝", "meta"],
                  status: "PROCESSED",
                  retry_count: 2,
                  warnings: ["KANA", "GLOSSARY"],
                  warning_fragments_by_code: { KANA: ["カナ"] },
                  glossary_applications: [
                    {
                      entry_id: "HP::0",
                      src: "HP",
                      dst: "生命值",
                      case_sensitive: false,
                      fields: [{ source_field: "src", target_field: "dst", applied: false }],
                    },
                  ],
                  row_id: "7",
                  compressed_src: "HP",
                  compressed_dst: "カナ",
                  internal_file_path: "private.json",
                  extra_field: { private: true },
                },
              ],
        invalid_regex_message: null,
      },
    }));
    const tools = create_agent_item_tools({
      cache: create_cache(() => []),
      proofreading: create_proofreading({ query_warnings }),
    });
    const tool = tools.find((candidate) => candidate.name === "query_warning_items");
    if (tool === undefined) throw new Error("缺少 query_warning_items");

    const result = await tool.execute(
      "warnings",
      {
        filters: { statuses: ["PROCESSED"], file_paths: ["script.txt"] },
        search: { keyword: "hp", scope: "src", case_sensitive: false },
        cursor: "2",
        limit: 5,
      },
      undefined,
      undefined,
      undefined as never,
    );

    expect(query_warnings).toHaveBeenCalledWith({
      warning_types: [
        "KANA",
        "HANGEUL",
        "TEXT_PRESERVE",
        "SIMILARITY",
        "GLOSSARY",
        "RETRY_THRESHOLD",
      ],
      statuses: ["PROCESSED"],
      file_paths: ["script.txt"],
      keyword: "hp",
      scope: "src",
      is_regex: false,
      case_sensitive: false,
      offset: 2,
      limit: 5,
    });
    expect(result.details).toMatchObject({
      projectPath: "test.lg",
      sectionRevisions: { files: 1, items: 2, quality: 3, proofreading: 4 },
      total_item_count: 4,
      cursor: "3",
      complete: false,
      items: [
        {
          item_id: 7,
          warnings: ["KANA", "GLOSSARY"],
          warning_fragments_by_code: { KANA: ["カナ"] },
          glossary_applications: [{ entry_id: "HP::0" }],
        },
      ],
    });
    const item = ((result.details as JsonRecord)["items"] as JsonRecord[])[0];
    expect(item).not.toHaveProperty("row_id");
    expect(item).not.toHaveProperty("compressed_src");
    expect(item).not.toHaveProperty("compressed_dst");
    expect(item).not.toHaveProperty("internal_file_path");
    expect(item).not.toHaveProperty("extra_field");

    const beyond = await tool.execute(
      "beyond",
      { cursor: "99" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(beyond.details).toMatchObject({ items: [], cursor: null, complete: true });
  });

  it("query_warning_items 拒绝虚拟警告、非法参数与非法正则", async () => {
    const query_warnings = vi.fn<AgentProofreading["query"]["query_warnings"]>(async () => ({
      projectPath: "test.lg",
      sectionRevisions: { items: 2, proofreading: 3 },
      data: {
        total_item_count: 1,
        items: [],
        invalid_regex_message: "Invalid regular expression",
      },
    }));
    const tools = create_agent_item_tools({
      cache: create_cache(() => []),
      proofreading: create_proofreading({ query_warnings }),
    });
    const tool = tools.find((candidate) => candidate.name === "query_warning_items");
    if (tool === undefined) throw new Error("缺少 query_warning_items");
    const execute = async (params: unknown) =>
      tool.execute("invalid", params as never, undefined, undefined, undefined as never);

    for (const params of [
      { filters: { warning_types: [] } },
      { filters: { warning_types: ["KANA", "KANA"] } },
      { filters: { warning_types: ["NO_WARNING"] } },
      { filters: { file_paths: [""] } },
      { search: { keyword: "  " } },
      { cursor: "-1" },
      { limit: 101 },
      { filters: { nope: true } },
      { nope: true },
    ]) {
      await expect(execute(params)).rejects.toThrow();
    }
    expect(query_warnings).not.toHaveBeenCalled();
    await expect(execute({ search: { keyword: "(", is_regex: true } })).rejects.toThrow(
      "Invalid regular expression",
    );
  });

  it("query_warning_items 在查询前后都响应取消", async () => {
    const controller = new AbortController();
    const query_warnings = vi.fn<AgentProofreading["query"]["query_warnings"]>(async () => {
      controller.abort();
      return {
        projectPath: "test.lg",
        sectionRevisions: {},
        data: { total_item_count: 0, items: [], invalid_regex_message: null },
      };
    });
    const tool = create_agent_item_tools({
      cache: create_cache(() => []),
      proofreading: create_proofreading({ query_warnings }),
    }).find((candidate) => candidate.name === "query_warning_items");
    if (tool === undefined) throw new Error("缺少 query_warning_items");

    const already_aborted = new AbortController();
    already_aborted.abort();
    await expect(
      tool.execute("before", {}, already_aborted.signal, undefined, undefined as never),
    ).rejects.toThrow();
    expect(query_warnings).not.toHaveBeenCalled();
    await expect(
      tool.execute("after", {}, controller.signal, undefined, undefined as never),
    ).rejects.toThrow();
    expect(query_warnings).toHaveBeenCalledTimes(1);
  });

  it("update_items 一次提交混合字段并按请求顺序返回最新条目", async () => {
    let revisions = { items: 2, proofreading: 3 };
    const items = [create_item(1), create_item(2)];
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
      proofreading: create_proofreading({ update_items_from_agent: update_items }),
    });
    const tool = tools.find((candidate) => candidate.name === "update_items");
    if (tool === undefined) throw new Error("缺少 update_items");
    const request = {
      changes: [
        { item_id: 2, name_dst: "二号", status: "EXCLUDED" as const },
        { item_id: 1, dst: "一号译文" },
      ],
      expected_section_revisions: { items: 2, proofreading: 3 },
    };

    const result = await tool.execute("update", request, undefined, undefined, undefined as never);
    expect(update_items).toHaveBeenCalledWith(request, AGENT_PROOFREADING_UPDATE_SOURCE);
    expect(result.details).toMatchObject({
      accepted: true,
      sectionRevisions: { items: 3, proofreading: 4 },
      items: [
        { item_id: 2, name_dst: "二号", status: "EXCLUDED" },
        { item_id: 1, dst: "一号译文" },
      ],
    });

    await expect(
      tool.execute(
        "duplicate",
        {
          changes: [
            { item_id: 1, dst: "A" },
            { item_id: 1, status: "NONE" },
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

import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import type { ProjectWriteResult } from "../../shared/project-event";
import { PROOFREADING_WARNING_CODES } from "../../shared/proofreading/proofreading-types";
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
          data: { total_item_count: 0, items: [] },
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

/** 构造写工具关心的最窄项目事件回执，省略 ID 用于验证异常确认。 */
function create_item_write_result(changed_ids?: number[]): ProjectWriteResult {
  return {
    accepted: true,
    changes: [
      {
        type: "project.changed",
        eventId: "item-change",
        source: AGENT_PROOFREADING_UPDATE_SOURCE,
        projectPath: "test.lg",
        projectRevision: 4,
        sectionRevisions: { items: 3, proofreading: 4 },
        updatedSections: ["items", "proofreading"],
        ...(changed_ids === undefined
          ? {}
          : { items: { payloadMode: "canonical-delta", changedIds: changed_ids } }),
      },
    ],
  };
}

describe("Agent item 工具", () => {
  it("按固定顺序注册工具，并由 SDK 独占结构参数校验", () => {
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
    const query_tool = tools[0];
    const warning_tool = tools[1];
    const update_tool = tools[2];
    if (query_tool === undefined || warning_tool === undefined || update_tool === undefined) {
      throw new Error("缺少 item 工具");
    }
    const revisions = { items: 2, proofreading: 3 };
    const write_call: ToolCall = {
      type: "toolCall",
      id: "write-update",
      name: "update_items",
      arguments: {
        write: [{ item_id: 1, field: "dst", value: "新译文" }],
        expected_revisions: revisions,
      },
    };
    expect(validateToolArguments(update_tool, write_call)).toEqual(write_call.arguments);
    for (const arguments_ of [
      {
        patches: [{ item_id: 1, dst: "旧协议" }],
        expected_revisions: revisions,
      },
      {
        write: [{ item_id: 1, field: "dst", value: "旧 revision 字段" }],
        expected_section_revisions: revisions,
      },
      {
        write: [{ item_id: 1, value: "缺少字段" }],
        expected_revisions: revisions,
      },
      {
        write: [{ item_id: 1, field: "dst" }],
        expected_revisions: revisions,
      },
      {
        write: [{ item_id: 1, field: "src", value: "不可写字段" }],
        expected_revisions: revisions,
      },
      {
        write: [{ item_id: 1, field: "dst", value: "新译文", status: "PROCESSED" }],
        expected_revisions: revisions,
      },
      {
        write: [{ item_id: Number.MAX_SAFE_INTEGER + 1, field: "dst", value: "越界 ID" }],
        expected_revisions: revisions,
      },
    ]) {
      expect(() =>
        validateToolArguments(update_tool, {
          ...write_call,
          id: "invalid-update",
          arguments: arguments_,
        }),
      ).toThrow();
    }

    for (const [tool, arguments_] of [
      [query_tool, { search: { keywords: ["  "] } }],
      [query_tool, { search: { keyword: "旧协议" } }],
      [query_tool, { search: { keywords: ["A"], case_sensitive: true } }],
      [query_tool, { search: { keywords: ["A"], is_regex: true } }],
      [query_tool, { cursor: "-1" }],
      [query_tool, { filters: { item_ids: [Number.MAX_SAFE_INTEGER + 1] } }],
      [query_tool, { nope: true }],
      [warning_tool, { filters: { warning_types: ["NO_WARNING"] } }],
      [warning_tool, { search: { keywords: ["A"], is_regex: true } }],
      [warning_tool, { limit: 101 }],
    ] as const) {
      expect(() =>
        validateToolArguments(tool, {
          type: "toolCall",
          id: "invalid-query",
          name: tool.name,
          arguments: arguments_,
        }),
      ).toThrow();
    }

    for (const [tool, arguments_] of [
      [query_tool, {}],
      [warning_tool, {}],
      [query_tool, { filters: {} }],
      [warning_tool, { filters: {} }],
      [
        query_tool,
        {
          filters: { item_ids: [], statuses: [], file_paths: [] },
          search: { keywords: [] },
          cursor: "0",
        },
      ],
      [
        warning_tool,
        {
          filters: { warning_types: [], statuses: [], file_paths: [] },
          search: { keywords: [] },
          cursor: "0",
        },
      ],
      [
        query_tool,
        {
          filters: {
            item_ids: [1, 1],
            statuses: ["NONE", "NONE"],
            file_paths: ["script.txt", "script.txt"],
          },
          search: { keywords: ["リ", "リ"], scope: "src" },
        },
      ],
      [
        warning_tool,
        {
          filters: {
            warning_types: ["KANA", "KANA"],
            statuses: ["NONE", "NONE"],
            file_paths: ["script.txt", "script.txt"],
          },
          search: { keywords: ["リ", "リ"], scope: "src" },
        },
      ],
    ] as const) {
      expect(
        validateToolArguments(tool, {
          type: "toolCall",
          id: "duplicate-query-values",
          name: tool.name,
          arguments: arguments_,
        }),
      ).toEqual(arguments_);
    }
  });

  it("组合筛选、统计与分页，并保持 ID 请求顺序和窄投影", () => {
    const values = [
      create_item(2, {
        status: "PROCESSED",
        file_path: "a.txt",
        name_src: ["Alice", "meta"],
        name_dst: ["艾丽丝", "meta"],
      }),
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
    expect(page).toEqual({
      revisions: { items: 2, proofreading: 3 },
      total_item_count: 2,
      items: [
        {
          item_id: 2,
          src: "原文 2",
          dst: "译文 2",
          name_src: "Alice",
          name_dst: "艾丽丝",
          row_number: 2,
          file_path: "a.txt",
          status: "PROCESSED",
          retry_count: 2,
        },
      ],
      cursor: "1",
    });

    const ids = query_agent_items(cache, {
      filters: { item_ids: [3, 404, 2, 3], statuses: ["PROCESSED"] },
    });
    expect(ids).toEqual({
      revisions: { items: 2, proofreading: 3 },
      total_item_count: 2,
      items: [
        {
          item_id: 3,
          src: "原文 3",
          dst: "译文 3",
          row_number: 3,
          file_path: "a.txt",
          status: "PROCESSED",
          retry_count: 3,
        },
        {
          item_id: 2,
          src: "原文 2",
          dst: "译文 2",
          name_src: "Alice",
          name_dst: "艾丽丝",
          row_number: 2,
          file_path: "a.txt",
          status: "PROCESSED",
          retry_count: 2,
        },
      ],
    });

    expect(
      query_agent_items(cache, {
        filters: { item_ids: [], statuses: [], file_paths: [] },
        search: { keywords: [] },
        cursor: "0",
      }),
    ).toEqual(query_agent_items(cache, {}));

    const beyond = query_agent_items(cache, { cursor: "99" });
    expect(beyond).toEqual({
      revisions: { items: 2, proofreading: 3 },
      total_item_count: 3,
      items: [],
    });
  });

  it("按 src/dst/all 对多个关键词做 OR 搜索并返回命中归因", () => {
    const cache = create_cache(() => [
      create_item(1, { src: "Alpha", name_src: "ALICE", dst: "Beta", name_dst: "贝塔" }),
      create_item(2, { src: "beta", dst: "alpha", name_dst: "ALPHA" }),
      create_item(3, { src: "^Alpha$", dst: "literal" }),
    ]);

    expect(
      (
        query_agent_items(cache, {
          search: { keywords: ["alice", "ALICE", "beta", "beta"], scope: "src" },
        })["items"] as JsonRecord[]
      ).map((item) => [item["item_id"], item["matched_keywords"]]),
    ).toEqual([
      [1, ["alice"]],
      [2, ["beta"]],
    ]);
    expect(
      (
        query_agent_items(cache, {
          search: { keywords: ["^alpha$"], scope: "src" },
        })["items"] as JsonRecord[]
      ).map((item) => [item["item_id"], item["matched_keywords"]]),
    ).toEqual([[3, ["^alpha$"]]]);
    expect(
      (
        query_agent_items(cache, {
          search: { keywords: ["beta"], scope: "all" },
        })["items"] as JsonRecord[]
      ).map((item) => item["item_id"]),
    ).toEqual([1, 2]);
    expect(() => query_agent_items(cache, { cursor: "9007199254740992" })).toThrow(
      "item.invalid_cursor",
    );
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
        filters: {
          statuses: ["PROCESSED", "PROCESSED"],
          file_paths: ["script.txt", "script.txt"],
        },
        search: { keywords: ["hp", "HP"], scope: "src" },
        cursor: "2",
        limit: 5,
      },
      undefined,
      undefined,
      undefined as never,
    );

    expect(query_warnings).toHaveBeenCalledWith({
      warning_types: [...PROOFREADING_WARNING_CODES],
      statuses: ["PROCESSED"],
      file_paths: ["script.txt"],
      keywords: ["hp"],
      scope: "src",
      offset: 2,
      limit: 5,
    });
    expect(result.details).toEqual({
      revisions: { items: 2, proofreading: 4 },
      total_item_count: 4,
      cursor: "3",
      items: [
        {
          item_id: 7,
          file_path: "script.txt",
          row_number: 9,
          src: "HP",
          dst: "カナ",
          name_src: "Alice",
          name_dst: "艾丽丝",
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
        },
      ],
    });

    query_warnings.mockClear();
    await tool.execute(
      "empty-query",
      {
        filters: { warning_types: [], statuses: [], file_paths: [] },
        search: { keywords: [] },
        cursor: "0",
      },
      undefined,
      undefined,
      undefined as never,
    );
    expect(query_warnings).toHaveBeenCalledWith(
      expect.objectContaining({
        warning_types: [...PROOFREADING_WARNING_CODES],
        keywords: [],
        scope: "all",
        offset: 0,
      }),
    );

    const beyond = await tool.execute(
      "beyond",
      { cursor: "99" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(beyond.details).toEqual({
      revisions: { items: 2, proofreading: 4 },
      total_item_count: 4,
      items: [],
    });
  });

  it("query_warning_items 在查询前后都响应取消", async () => {
    const controller = new AbortController();
    const query_warnings = vi.fn<AgentProofreading["query"]["query_warnings"]>(async () => {
      controller.abort();
      return {
        projectPath: "test.lg",
        sectionRevisions: {},
        data: { total_item_count: 0, items: [] },
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

  it("update_items 聚合同一 item 的单字段 write 并返回紧凑权威回执", async () => {
    const revisions = { items: 2, proofreading: 3 };
    const update_items = vi.fn(async (request: JsonRecord): Promise<ProjectWriteResult> =>
      create_item_write_result(
        (request["changes"] as JsonRecord[]).map((change) => change["item_id"] as number),
      ),
    );
    const tools = create_agent_item_tools({
      cache: create_cache(
        () => [],
        () => revisions,
      ),
      proofreading: create_proofreading({ update_items_from_agent: update_items }),
    });
    const tool = tools.find((candidate) => candidate.name === "update_items");
    if (tool === undefined) throw new Error("缺少 update_items");
    const request = {
      write: [
        { item_id: 2, field: "name_dst" as const, value: "" },
        { item_id: 2, field: "status" as const, value: "EXCLUDED" },
        { item_id: 1, field: "dst" as const, value: "一号译文" },
      ],
      expected_revisions: { items: 2, proofreading: 3 },
    };

    const result = await tool.execute("update", request, undefined, undefined, undefined as never);
    expect(update_items).toHaveBeenCalledWith(
      {
        changes: [
          { item_id: 2, name_dst: "", status: "EXCLUDED" },
          { item_id: 1, dst: "一号译文" },
        ],
        expected_section_revisions: request.expected_revisions,
      },
      AGENT_PROOFREADING_UPDATE_SOURCE,
    );
    expect(result.details).toEqual({
      status: "applied",
      revisions: { items: 3, proofreading: 4 },
      updated: [2, 1],
    });

    await expect(
      tool.execute(
        "duplicate",
        {
          write: [
            { item_id: 1, field: "dst", value: "A" },
            { item_id: 1, field: "dst", value: "B" },
          ],
          expected_revisions: revisions,
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({
      details: {
        code: "item.duplicate_write_target",
        item_id: 1,
        field: "dst",
        paths: ["write[0].field", "write[1].field"],
      },
    });
    await expect(
      tool.execute(
        "invalid-status",
        {
          write: [{ item_id: 1, field: "status", value: "ERROR" }],
          expected_revisions: revisions,
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({
      details: {
        code: "item.invalid_write_value",
        field: "status",
        path: "write[0].value",
      },
    });
    expect(update_items).toHaveBeenCalledTimes(1);
  });

  it("update_items 对超过默认查询页的写入仍返回全部实际更新 ID", async () => {
    const updated = Array.from({ length: 25 }, (_, index) => index + 1);
    const update_items = vi.fn(async (): Promise<ProjectWriteResult> =>
      create_item_write_result(updated),
    );
    const tool = create_agent_item_tools({
      cache: create_cache(() => []),
      proofreading: create_proofreading({ update_items_from_agent: update_items }),
    }).find((candidate) => candidate.name === "update_items");
    if (tool === undefined) throw new Error("缺少 update_items");

    const result = await tool.execute(
      "many",
      {
        write: updated.map((item_id) => ({
          item_id,
          field: "dst" as const,
          value: `新译文 ${item_id.toString()}`,
        })),
        expected_revisions: { items: 2, proofreading: 3 },
      },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.details).toEqual({
      status: "applied",
      revisions: { items: 3, proofreading: 4 },
      updated,
    });
  });

  it("update_items 回执缺少实际更新 ID 时拒绝确认成功", async () => {
    const update_items = vi.fn(async (): Promise<ProjectWriteResult> => create_item_write_result());
    const tool = create_agent_item_tools({
      cache: create_cache(() => []),
      proofreading: create_proofreading({ update_items_from_agent: update_items }),
    }).find((candidate) => candidate.name === "update_items");
    if (tool === undefined) throw new Error("缺少 update_items");

    await expect(
      tool.execute(
        "unconfirmed",
        {
          write: [{ item_id: 1, field: "dst", value: "新译文" }],
          expected_revisions: { items: 2, proofreading: 3 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("item.write_not_confirmed");
  });

  it("update_items 没有实际变化时返回 unchanged 和当前 revision", async () => {
    const tool = create_agent_item_tools({
      cache: create_cache(() => []),
      proofreading: create_proofreading(),
    }).find((candidate) => candidate.name === "update_items");
    if (tool === undefined) throw new Error("缺少 update_items");

    const result = await tool.execute(
      "unchanged",
      {
        write: [{ item_id: 1, field: "dst", value: "既有译文" }],
        expected_revisions: { items: 2, proofreading: 3 },
      },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.details).toEqual({
      status: "unchanged",
      revisions: { items: 2, proofreading: 3 },
    });
  });
});

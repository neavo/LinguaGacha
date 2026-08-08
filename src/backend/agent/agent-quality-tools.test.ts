import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import { RevisionConflictError } from "../../shared/error/errors/data-errors";
import type { ProjectWriteResult } from "../../shared/project-event";
import {
  AGENT_QUALITY_RULE_UPDATE_SOURCE,
  create_agent_quality_tools,
  query_agent_quality_rules,
} from "./agent-quality-tools";

function stored_entry(entry_id: string, src: string, dst: string): JsonRecord {
  return { entry_id, src, dst, info: "其他", case_sensitive: false };
}

function create_analysis(
  args: {
    ids?: string[];
    hits?: Record<string, number>;
    examples?: Record<string, string[]>;
    groups?: string[][];
    parents?: Record<string, string[]>;
    items_revision?: number;
  } = {},
) {
  const ids = args.ids ?? [];
  return {
    read: vi.fn(async () => ({
      projectPath: "test.lg",
      sectionRevisions: { quality: 4, items: args.items_revision ?? 7 },
      analysis: {
        entry_ids: ids,
        hits_by_entry_id: args.hits ?? Object.fromEntries(ids.map((id) => [id, 0])),
        examples_by_entry_id: args.examples ?? Object.fromEntries(ids.map((id) => [id, []])),
        relations: {
          subset_parents_by_entry_id: args.parents ?? {},
          groups: args.groups ?? ids.map((id) => [id]),
        },
      },
    })),
  };
}

function create_dependencies(entries: JsonRecord[] = []) {
  return {
    qualityRules: {
      query: () => ({
        projectPath: "test.lg",
        sectionRevisions: { quality: 4 },
        qualityRule: { entries },
      }),
      update_from_agent: vi.fn(),
    },
    qualityAnalysis: create_analysis({
      ids: entries.map((entry) => String(entry["entry_id"])),
    }),
  };
}

function find_tool(tools: ReturnType<typeof create_agent_quality_tools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`缺少 ${name}`);
  return tool;
}

/** 构造质量规则写入口的最小成功确认。 */
function create_write_result(revision: number): ProjectWriteResult {
  return {
    accepted: true,
    changes: [
      {
        type: "project.changed",
        eventId: `change-${revision.toString()}`,
        source: AGENT_QUALITY_RULE_UPDATE_SOURCE,
        projectPath: "test.lg",
        projectRevision: revision,
        sectionRevisions: { quality: revision },
        updatedSections: ["quality"],
      },
    ],
  };
}

describe("Agent 质量规则工具", () => {
  it("注册通用查询工具与串行写入口", () => {
    const tools = create_agent_quality_tools(create_dependencies());

    expect(tools.map((tool) => tool.name)).toEqual(["query_quality_rules", "update_quality_rules"]);
    expect(tools.map((tool) => tool.executionMode)).toEqual([undefined, "sequential"]);
  });

  it("查询参数接受字面量搜索和可选 examples", () => {
    const tool = find_tool(
      create_agent_quality_tools(create_dependencies()),
      "query_quality_rules",
    );
    const validate = (arguments_: JsonRecord) =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "query",
        name: tool.name,
        arguments: arguments_,
      });

    expect(validate({ rule_type: "glossary", include_examples: true })).toEqual({
      rule_type: "glossary",
      include_examples: true,
    });
    expect(validate({ rule_type: "text_preserve", search: { keywords: ["白之城"] } })).toEqual({
      rule_type: "text_preserve",
      search: { keywords: ["白之城"] },
    });
    expect(() => validate({ rule_type: "glossary", search: { keywords: [" "] } })).toThrow();
    expect(() =>
      validate({ rule_type: "glossary", search: { keywords: ["A"], is_regex: true } }),
    ).toThrow();
  });

  it("写协议只公开 id 与 before_id", () => {
    const tool = find_tool(
      create_agent_quality_tools(create_dependencies()),
      "update_quality_rules",
    );
    const payload = {
      rule_type: "glossary",
      write: [
        {
          id: "a",
          entry: { src: "A", dst: "甲", info: "名称", case_sensitive: false },
        },
        {
          before_id: "a",
          entry: { src: "B", dst: "乙", info: "名称", case_sensitive: false },
        },
      ],
      move: [{ id: "a", before_id: null }],
      expected_revision: 1,
    } satisfies JsonRecord;
    const call: ToolCall = {
      type: "toolCall",
      id: "update",
      name: tool.name,
      arguments: payload,
    };

    expect(validateToolArguments(tool, call)).toEqual(payload);
    expect(() =>
      validateToolArguments(tool, {
        ...call,
        arguments: {
          rule_type: "glossary",
          write: [{ entry_id: "a", entry: payload.write[0]?.entry }],
          expected_revision: 1,
        },
      }),
    ).toThrow();
  });

  it("四类规则共享 revisions、groups、hits 和 id 投影", async () => {
    const rules: Record<string, JsonRecord[]> = {
      glossary: [stored_entry("a", "白之城", "White City")],
      pre_replacement: [
        { entry_id: "pre", src: "A", dst: "B", regex: false, case_sensitive: false },
      ],
      post_replacement: [
        { entry_id: "post", src: "B", dst: "C", regex: true, case_sensitive: true },
      ],
      text_preserve: [{ entry_id: "keep", src: "N", info: "控制码" }],
    };
    const hits_by_kind = {
      glossary: 3,
      pre_replacement: 2,
      post_replacement: 1,
      text_preserve: 4,
    };
    const analysis_by_kind = {
      glossary: create_analysis({ ids: ["a"], hits: { a: hits_by_kind.glossary } }),
      pre_replacement: create_analysis({
        ids: ["pre"],
        hits: { pre: hits_by_kind.pre_replacement },
      }),
      post_replacement: create_analysis({
        ids: ["post"],
        hits: { post: hits_by_kind.post_replacement },
      }),
      text_preserve: create_analysis({
        ids: ["keep"],
        hits: { keep: hits_by_kind.text_preserve },
      }),
    };
    const dependencies = {
      qualityRules: {
        query: ({ rule_type }: JsonRecord) => ({
          sectionRevisions: { quality: 4 },
          qualityRule: { entries: rules[String(rule_type)] },
        }),
        update_from_agent: vi.fn(),
      },
      qualityAnalysis: {
        read: (kind: keyof typeof analysis_by_kind) => analysis_by_kind[kind].read(),
      },
    };

    for (const kind of [
      "glossary",
      "pre_replacement",
      "post_replacement",
      "text_preserve",
    ] as const) {
      const result = await query_agent_quality_rules(dependencies, { rule_type: kind });
      const stored = rules[kind]?.[0] ?? {};
      const id = String(stored["entry_id"]);
      const public_entry = Object.fromEntries(
        Object.entries(stored).filter(([key]) => key !== "entry_id"),
      );
      expect(result).toEqual({
        rule_type: kind,
        revisions: { quality: 4, items: 7 },
        groups: [[id]],
        entries: [{ ...public_entry, id, hits: hits_by_kind[kind] }],
      });
    }
  });

  it("旧规则缺少持久化 ID 时仍以稳定迁移身份查询", async () => {
    const dependencies = create_dependencies([
      { src: "Legacy", dst: "旧译", info: "名称", case_sensitive: false },
    ]);
    dependencies.qualityAnalysis = create_analysis({
      ids: ["Legacy::0"],
      hits: { "Legacy::0": 2 },
    });

    await expect(
      query_agent_quality_rules(dependencies, { rule_type: "glossary" }),
    ).resolves.toEqual({
      rule_type: "glossary",
      revisions: { quality: 4, items: 7 },
      entries: [
        {
          id: "Legacy::0",
          src: "Legacy",
          dst: "旧译",
          info: "名称",
          case_sensitive: false,
          hits: 2,
        },
      ],
      groups: [["Legacy::0"]],
    });
  });

  it("搜索只标记直接目标，并展开其完整通用组", async () => {
    const entries = [
      stored_entry("family", "ドトール家", "多托尔家"),
      stored_entry("earl", "ドトール伯爵家", "多托尔伯爵家"),
      stored_entry("ghost", "Ghost", "幽灵"),
    ];
    const dependencies = create_dependencies(entries);
    dependencies.qualityAnalysis = create_analysis({
      ids: ["family", "earl", "ghost"],
      groups: [["family", "earl"], ["ghost"]],
    });

    const result = await query_agent_quality_rules(dependencies, {
      rule_type: "glossary",
      search: { keywords: ["ドトール伯爵家"] },
    });

    expect(result).toMatchObject({
      groups: [["family", "earl"]],
      target_ids: ["earl"],
      entries: [{ id: "family" }, { id: "earl" }],
    });
  });

  it("include_examples 只控制查询投影，不触发额外分析", async () => {
    const dependencies = create_dependencies([stored_entry("x", "X", "甲")]);
    dependencies.qualityAnalysis = create_analysis({
      ids: ["x"],
      hits: { x: 5 },
      examples: { x: ["【Alice】X 对话", "另一处 X"] },
    });

    const compact = await query_agent_quality_rules(dependencies, { rule_type: "glossary" });
    const detailed = await query_agent_quality_rules(dependencies, {
      rule_type: "glossary",
      include_examples: true,
    });

    expect(compact.entries[0]).toMatchObject({ id: "x", hits: 5 });
    expect(compact.entries[0]).not.toHaveProperty("examples");
    expect(detailed.entries[0]).toMatchObject({
      id: "x",
      hits: 5,
      examples: ["【Alice】X 对话", "另一处 X"],
    });
    expect(dependencies.qualityAnalysis.read).toHaveBeenCalledTimes(2);
  });

  it("空变更和非法条目在持久化前失败", async () => {
    const dependencies = create_dependencies([]);
    const tool = find_tool(create_agent_quality_tools(dependencies), "update_quality_rules");

    await expect(
      tool.execute(
        "empty",
        { rule_type: "glossary", write: [], delete: [], move: [], expected_revision: 4 },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("quality_rule.empty_change");
    await expect(
      tool.execute(
        "invalid",
        {
          rule_type: "glossary",
          write: [{ entry: { src: "A", dst: " ", info: "", case_sensitive: false } }],
          expected_revision: 4,
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({
      details: { code: "quality_rule.empty_entry_field", path: "write[0].entry.dst" },
    });
    expect(dependencies.qualityRules.update_from_agent).not.toHaveBeenCalled();
  });

  it("同一提交拒绝多个内容操作指向同一条目", async () => {
    const dependencies = create_dependencies([
      stored_entry("a", "A", "甲"),
      stored_entry("b", "B", "乙"),
    ]);
    const tool = find_tool(create_agent_quality_tools(dependencies), "update_quality_rules");

    await expect(
      tool.execute(
        "conflicting-target",
        {
          rule_type: "glossary",
          write: [{ id: "a", entry: { src: "A", dst: "甲", info: "其他", case_sensitive: false } }],
          delete: ["a"],
          expected_revision: 4,
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({ details: { code: "quality_rule.target_conflict" } });
    expect(dependencies.qualityRules.update_from_agent).not.toHaveBeenCalled();
  });

  it("更新已有条目时拒绝创建专用的定位字段", async () => {
    const dependencies = create_dependencies([
      stored_entry("a", "A", "甲"),
      stored_entry("b", "B", "乙"),
    ]);
    const tool = find_tool(create_agent_quality_tools(dependencies), "update_quality_rules");

    await expect(
      tool.execute(
        "invalid-placement",
        {
          rule_type: "glossary",
          write: [
            {
              id: "a",
              before_id: "b",
              entry: { src: "A", dst: "甲", info: "其他", case_sensitive: false },
            },
          ],
          expected_revision: 4,
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({ details: { code: "quality_rule.invalid_write" } });
    expect(dependencies.qualityRules.update_from_agent).not.toHaveBeenCalled();
  });

  it("预期集合拒绝新增重复并允许清理历史重复", async () => {
    const rejecting = create_dependencies([
      stored_entry("a", "A", "甲"),
      stored_entry("b", "B", "乙"),
    ]);
    const rejecting_tool = find_tool(create_agent_quality_tools(rejecting), "update_quality_rules");
    await expect(
      rejecting_tool.execute(
        "duplicate",
        {
          rule_type: "glossary",
          write: [{ id: "a", entry: { src: "B", dst: "甲", info: "其他", case_sensitive: false } }],
          expected_revision: 4,
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({ details: { code: "quality_rule.duplicate_final_entry" } });
    expect(rejecting.qualityRules.update_from_agent).not.toHaveBeenCalled();

    const cleaning = create_dependencies([
      stored_entry("a", "B", "甲"),
      stored_entry("b", "B", "乙"),
    ]);
    cleaning.qualityRules.update_from_agent.mockResolvedValue(create_write_result(5));
    const cleaning_tool = find_tool(create_agent_quality_tools(cleaning), "update_quality_rules");
    await expect(
      cleaning_tool.execute(
        "cleanup",
        { rule_type: "glossary", delete: ["a"], expected_revision: 4 },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toMatchObject({ details: { status: "applied", deleted: ["a"] } });
  });

  it("一次原子应用增删改和重排，创建回执使用 id", async () => {
    let entries = [
      stored_entry("a", "Alpha", "甲"),
      stored_entry("b", "Beta", "乙"),
      stored_entry("c", "Gamma", "丙"),
    ];
    const update = vi.fn(async (request: JsonRecord): Promise<ProjectWriteResult> => {
      entries = structuredClone(request["entries"] as JsonRecord[]);
      return create_write_result(5);
    });
    const tool = find_tool(
      create_agent_quality_tools({
        qualityRules: {
          query: () => ({ sectionRevisions: { quality: 4 }, qualityRule: { entries } }),
          update_from_agent: update,
        },
        qualityAnalysis: create_analysis(),
      }),
      "update_quality_rules",
    );

    const result = await tool.execute(
      "update",
      {
        rule_type: "glossary",
        write: [
          {
            before_id: "a",
            entry: { src: "Delta", dst: "丁", info: "", case_sensitive: false },
          },
          {
            id: "a",
            entry: { src: "Alpha Prime", dst: "A", info: "", case_sensitive: false },
          },
        ],
        delete: ["b"],
        move: [{ id: "a", before_id: null }],
        expected_revision: 4,
      },
      undefined,
      undefined,
      undefined as never,
    );

    expect(entries.map((entry) => entry["src"])).toEqual(["Delta", "Gamma", "Alpha Prime"]);
    expect(result.details).toMatchObject({
      status: "applied",
      revision: 5,
      created: [{ write_index: 0, id: expect.stringMatching(/^qr:/u) }],
      updated: ["a"],
      deleted: ["b"],
      moved: ["a"],
    });
  });

  it("内容和顺序均未变化时不写入", async () => {
    const dependencies = create_dependencies([
      stored_entry("a", "A", "甲"),
      stored_entry("b", "B", "乙"),
    ]);
    const tool = find_tool(create_agent_quality_tools(dependencies), "update_quality_rules");

    await expect(
      tool.execute(
        "unchanged",
        {
          rule_type: "glossary",
          write: [{ id: "a", entry: { src: "A", dst: "甲", info: "其他", case_sensitive: false } }],
          move: [{ id: "a", before_id: "b" }],
          expected_revision: 4,
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toMatchObject({ details: { status: "unchanged", revision: 4 } });
    expect(dependencies.qualityRules.update_from_agent).not.toHaveBeenCalled();
  });

  it("revision 冲突要求重新查询", async () => {
    const tool = find_tool(
      create_agent_quality_tools({
        qualityRules: {
          query: () => ({
            sectionRevisions: { quality: 3 },
            qualityRule: { entries: [stored_entry("a", "A", "甲")] },
          }),
          update_from_agent: async () => {
            throw new RevisionConflictError({
              public_details: {
                section: "quality",
                expected_revision: 2,
                current_revision: 3,
              },
            });
          },
        },
        qualityAnalysis: create_analysis(),
      }),
      "update_quality_rules",
    );

    await expect(
      tool.execute(
        "conflict",
        { rule_type: "glossary", delete: ["a"], expected_revision: 2 },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({
      details: { code: "data.revision_conflict", action: "query_quality_rules" },
    });
  });

  it("持久化入口没有返回提交确认时要求重新查询", async () => {
    const dependencies = create_dependencies([stored_entry("a", "A", "甲")]);
    dependencies.qualityRules.update_from_agent.mockResolvedValue({ accepted: true, changes: [] });
    const tool = find_tool(create_agent_quality_tools(dependencies), "update_quality_rules");

    await expect(
      tool.execute(
        "missing-confirmation",
        { rule_type: "glossary", delete: ["a"], expected_revision: 4 },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({
      details: { code: "quality_rule.write_not_confirmed", action: "query_quality_rules" },
    });
  });
});

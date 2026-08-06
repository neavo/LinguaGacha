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
import { ComputeWorkerClient } from "../worker/compute-worker-client";

function create_compute_worker(): ComputeWorkerClient {
  return new ComputeWorkerClient({ execution: { kind: "in_process" } });
}

function create_cache(items: JsonRecord[] = []) {
  return {
    items: { readItems: () => items },
  };
}

function stored_entry(entry_id: string, src: string, dst: string): JsonRecord {
  return { entry_id, src, dst, info: "其他", case_sensitive: false };
}

function find_tool(tools: ReturnType<typeof create_agent_quality_tools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`缺少 ${name}`);
  return tool;
}

describe("Agent 质量规则工具", () => {
  it("注册查询工具与串行写入口", () => {
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({}),
        update_from_agent: async () => ({ accepted: true, changes: [] }),
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });

    expect(tools.map((tool) => tool.name)).toEqual(["query_quality_rules", "update_quality_rules"]);
    expect(tools.map((tool) => tool.executionMode)).toEqual([undefined, "sequential"]);
  });

  it("SDK 真实校验器接受统一普通对象写入形状且不改写载荷", () => {
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({}),
        update_from_agent: async () => ({ accepted: true, changes: [] }),
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });
    const revision = { expected_section_revisions: { quality: 1 } };
    const tool = find_tool(tools, "update_quality_rules");
    const parameters = tool.parameters as JsonRecord;
    expect(parameters).toMatchObject({ type: "object", additionalProperties: false });
    expect(parameters).not.toHaveProperty("anyOf");
    expect(parameters).not.toHaveProperty("oneOf");
    const payloads: JsonRecord[] = [
      {
        rule_type: "glossary",
        write: [
          {
            entry: { src: "A", dst: "甲", info: "名称", case_sensitive: false },
            before_entry_id: "b",
          },
          {
            entry_id: "a",
            entry: { src: "A-1", dst: "乙", info: "名称", case_sensitive: true },
          },
        ],
        delete: ["b"],
        move: [{ entry_id: "a", before_entry_id: null }],
        ...revision,
      },
      {
        rule_type: "pre_replacement",
        write: [{ entry: { src: "A", dst: "B", regex: false, case_sensitive: false } }],
        ...revision,
      },
      {
        rule_type: "post_replacement",
        write: [{ entry: { src: "A", dst: "B", regex: true, case_sensitive: true } }],
        ...revision,
      },
      {
        rule_type: "text_preserve",
        write: [{ entry: { src: "\\\\N", info: "控制码" } }],
        ...revision,
      },
      {
        rule_type: "text_preserve",
        delete: ["keep"],
        ...revision,
      },
    ];

    for (const payload of payloads) {
      const call: ToolCall = {
        type: "toolCall",
        id: "test-call",
        name: tool.name,
        arguments: payload,
      };
      expect(validateToolArguments(tool, call), JSON.stringify(payload)).toEqual(payload);
    }
  });

  it("SDK 在执行前拒绝旧协议、设置写入和非结构化行为", () => {
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({}),
        update_from_agent: async () => ({ accepted: true, changes: [] }),
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });
    const revision = { expected_section_revisions: { quality: 1 } };
    const tool = find_tool(tools, "update_quality_rules");
    const validate = (payload: JsonRecord) =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "test-call",
        name: tool.name,
        arguments: payload,
      });
    const invalid_payloads: JsonRecord[] = [
      {
        rule_type: "glossary",
        changes: [{ action: "delete", entry_id: "a" }],
        ...revision,
      },
      { rule_type: "glossary", enabled: false, ...revision },
      { rule_type: "text_preserve", mode: "custom", ...revision },
      {
        rule_type: "glossary",
        delete: [{ entry_id: "a" }],
        ...revision,
      },
      {
        rule_type: "glossary",
        move: [{ entry_id: "a" }],
        ...revision,
      },
    ];
    for (const payload of invalid_payloads) {
      expect(() => validate(payload), JSON.stringify(payload)).toThrow();
    }
  });

  it("空写入在读取项目事实前失败", async () => {
    const query = vi.fn(() => ({}));
    const update = vi.fn(async (): Promise<ProjectWriteResult> => ({
      accepted: true,
      changes: [],
    }));
    const tools = create_agent_quality_tools({
      qualityRules: { query, update_from_agent: update },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });

    await expect(
      find_tool(tools, "update_quality_rules").execute(
        "empty",
        { rule_type: "glossary", expected_section_revisions: { quality: 1 } },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("quality_rule.empty_change");
    expect(query).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("空条目与空术语译文返回精确 code/path", async () => {
    const tool = find_tool(
      create_agent_quality_tools({
        qualityRules: {
          query: () => ({ sectionRevisions: { quality: 1 }, qualityRule: { entries: [] } }),
          update_from_agent: async () => ({ accepted: true, changes: [] }),
        },
        cache: create_cache(),
        computeWorker: create_compute_worker(),
      }),
      "update_quality_rules",
    );
    const execute = (entry: JsonRecord) =>
      tool.execute(
        "empty",
        {
          rule_type: "glossary",
          write: [{ entry }],
          expected_section_revisions: { quality: 1 },
        },
        undefined,
        undefined,
        undefined as never,
      );

    await expect(
      execute({ src: "   ", dst: "甲", info: "", case_sensitive: false }),
    ).rejects.toMatchObject({
      details: { code: "quality_rule.empty_entry", path: "write[0].entry" },
    });
    await expect(
      execute({ src: "Alpha", dst: "   ", info: "", case_sensitive: false }),
    ).rejects.toMatchObject({
      details: {
        code: "quality_rule.empty_entry_field",
        path: "write[0].entry.dst",
      },
    });
  });

  const corrupted_stored_entries: Array<{
    entries: JsonRecord | JsonRecord[];
    reason: string;
  }> = [
    { entries: {}, reason: "quality_rule_stored_entries_invalid" },
    {
      entries: [{ src: "Alpha", dst: "甲", info: "", case_sensitive: false }],
      reason: "quality_rule_stored_entry_id_missing",
    },
    {
      entries: [stored_entry("same", "Alpha", "甲"), stored_entry("same", "Beta", "乙")],
      reason: "quality_rule_duplicate_entry_id",
    },
  ];

  it.each(corrupted_stored_entries)(
    "存储条目损坏时报告内部不变量：$reason",
    async ({ entries, reason }) => {
      const tools = create_agent_quality_tools({
        qualityRules: {
          query: () => ({
            sectionRevisions: { quality: 1 },
            qualityRule: {
              enabled: true,
              entries,
            },
          }),
          update_from_agent: async () => ({ accepted: true, changes: [] }),
        },
        cache: create_cache(),
        computeWorker: create_compute_worker(),
      });

      await expect(
        find_tool(tools, "query_quality_rules").execute(
          "broken-store",
          { rule_type: "glossary" },
          undefined,
          undefined,
          undefined as never,
        ),
      ).rejects.toMatchObject({
        code: "runtime.internal_invariant",
        diagnostic_context: { reason },
      });
    },
  );

  it("查询四类规则，并为术语保留派生事实", async () => {
    const rules: Record<string, JsonRecord> = {
      glossary: {
        enabled: false,
        entries: [
          stored_entry("a", "白之城", "White City"),
          stored_entry("b", "白之城骑士", "Knight"),
          stored_entry("c", "白之城", "City"),
          stored_entry("d", "Ghost", "幽灵"),
        ],
      },
      pre_replacement: {
        enabled: true,
        entries: [{ entry_id: "pre", src: "A", dst: "B", regex: false }],
      },
      post_replacement: {
        enabled: false,
        entries: [{ entry_id: "post", src: "A", dst: "B", regex: true }],
      },
      text_preserve: {
        mode: "custom",
        entries: [{ entry_id: "keep", src: "\\\\N\\[\\d+\\]", info: "控制码" }],
      },
    };
    const dependencies = {
      qualityRules: {
        query: ({ rule_type }: JsonRecord) => ({
          projectPath: "test.lg",
          sectionRevisions: { quality: 4 },
          qualityRule: rules[String(rule_type)],
        }),
        update_from_agent: vi.fn(),
      },
      cache: create_cache([{ item_id: 1, src: "白之城骑士守护白之城", name_src: "白之城" }]),
      computeWorker: create_compute_worker(),
    };

    const pre_replacement = await query_agent_quality_rules(dependencies, "pre_replacement");
    expect(pre_replacement).toMatchObject({
      sectionRevisions: { quality: 4 },
      meta: { enabled: true },
      entries: [{ entry_id: "pre", src: "A", dst: "B", regex: false }],
    });
    expect(pre_replacement).not.toHaveProperty("projectPath");
    expect(await query_agent_quality_rules(dependencies, "post_replacement")).toMatchObject({
      meta: { enabled: false },
      entries: [{ entry_id: "post", regex: true }],
    });
    expect(await query_agent_quality_rules(dependencies, "text_preserve")).toMatchObject({
      meta: { mode: "custom" },
      entries: [{ entry_id: "keep", info: "控制码" }],
    });

    const glossary = await query_agent_quality_rules(dependencies, "glossary");
    expect(glossary).toMatchObject({ meta: { enabled: false } });
    expect(glossary.entries[0]).toMatchObject({ matched_item_count: 1, fact_violations: [] });
    expect(glossary.entries[3]).toMatchObject({
      matched_item_count: 0,
      fact_violations: ["zero_occurrence"],
    });
    expect(glossary.entries[0]).not.toHaveProperty("regex");
    expect((glossary["structure"] as JsonRecord)["duplicate_src_groups"]).toMatchObject([
      { entry_ids: ["a", "c"] },
    ]);
  });

  it("一次统计返回真实次数和首个有效 sample，无有效语境时为 null", async () => {
    const entries = [stored_entry("x", "X", "甲"), stored_entry("y", "Y", "乙")];
    const items = [
      { item_id: 1, src: "X", name_src: null, file_path: "a.txt", row_number: 1 },
      { item_id: 2, src: "X！", name_src: null, file_path: "a.txt", row_number: 2 },
      { item_id: 3, src: "对话 X X", name_src: "X", file_path: "b.txt", row_number: 3 },
      { item_id: 4, src: "Y。", name_src: null, file_path: "b.txt", row_number: 4 },
    ];
    const read_items = vi.fn(() => items);
    const cache = { ...create_cache(), items: { readItems: read_items } };
    const qualityRules = {
      query: () => ({
        projectPath: "test.lg",
        sectionRevisions: { quality: 4 },
        qualityRule: { enabled: true, entries },
      }),
      update_from_agent: vi.fn(),
    };
    const quality = await query_agent_quality_rules(
      { qualityRules, cache, computeWorker: create_compute_worker() },
      "glossary",
    );
    expect(quality.entries).toMatchObject([
      {
        entry_id: "x",
        matched_item_count: 3,
        total_matches: 5,
        sample: {
          item_id: 3,
          matched_fields: ["src", "name_src"],
          src: "对话 X X",
          name_src: "X",
          file_path: "b.txt",
          row_number: 3,
        },
      },
      { entry_id: "y", matched_item_count: 1, total_matches: 1, sample: null },
    ]);
    expect(read_items).toHaveBeenCalledTimes(1);
  });

  it("任一非法变更都整批拒绝且不调用持久化入口", async () => {
    const update = vi.fn(async (): Promise<ProjectWriteResult> => ({
      accepted: true,
      changes: [],
    }));
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({
          projectPath: "test.lg",
          sectionRevisions: { quality: 1 },
          qualityRule: { enabled: true, entries: [stored_entry("a", "Alpha", "甲")] },
        }),
        update_from_agent: update,
      },
      cache: create_cache([{ src: "Alpha Beta" }]),
      computeWorker: create_compute_worker(),
    });
    const tool = find_tool(tools, "update_quality_rules");
    const revision = { expected_section_revisions: { quality: 1 } };
    const invalid_payloads = [
      { rule_type: "glossary", delete: ["missing"], ...revision },
      {
        rule_type: "glossary",
        write: [
          {
            entry_id: "a",
            entry: { src: "Alpha", dst: "甲", info: "", case_sensitive: false },
            before_entry_id: "missing",
          },
        ],
        ...revision,
      },
      {
        rule_type: "glossary",
        write: [
          {
            entry_id: "a",
            entry: { src: "Alpha", dst: "甲", info: "", case_sensitive: false },
          },
          {
            entry_id: "a",
            entry: { src: "Alpha", dst: "   ", info: "", case_sensitive: false },
          },
        ],
        ...revision,
      },
      {
        rule_type: "pre_replacement",
        write: [{ entry: { src: "Alpha", dst: "甲", info: "", case_sensitive: false } }],
        ...revision,
      },
    ];
    for (const payload of invalid_payloads) {
      await expect(
        tool.execute("invalid", payload, undefined, undefined, undefined as never),
        JSON.stringify(payload),
      ).rejects.toThrow();
    }

    await expect(
      tool.execute(
        "invalid-regex",
        {
          rule_type: "text_preserve",
          write: [{ entry: { src: "[", info: "" } }],
          expected_section_revisions: { quality: 1 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("不是合法正则");
    expect(update).not.toHaveBeenCalled();
  });

  it("显式变更允许写入当前语料零命中的术语", async () => {
    const update = vi.fn(async (): Promise<ProjectWriteResult> => ({
      accepted: true,
      changes: [
        {
          type: "project.changed",
          eventId: "zero-occurrence",
          source: AGENT_QUALITY_RULE_UPDATE_SOURCE,
          projectPath: "test.lg",
          projectRevision: 2,
          sectionRevisions: { quality: 2 },
          updatedSections: ["quality"],
        },
      ],
    }));
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({
          sectionRevisions: { quality: 1 },
          qualityRule: { enabled: true, entries: [] },
        }),
        update_from_agent: update,
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });

    await expect(
      find_tool(tools, "update_quality_rules").execute(
        "zero-occurrence",
        {
          rule_type: "glossary",
          write: [{ entry: { src: "Ghost", dst: "幽灵", info: "", case_sensitive: false } }],
          expected_section_revisions: { quality: 1 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toMatchObject({ details: { status: "applied", revision: 2 } });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("prospective 状态拒绝新增重复但允许清理历史重复", async () => {
    let entries = [stored_entry("a", "A", "甲")];
    const update = vi.fn(async (): Promise<ProjectWriteResult> => ({
      accepted: true,
      changes: [
        {
          type: "project.changed",
          eventId: "cleanup",
          source: AGENT_QUALITY_RULE_UPDATE_SOURCE,
          projectPath: "test.lg",
          projectRevision: 2,
          sectionRevisions: { quality: 2 },
          updatedSections: ["quality"],
        },
      ],
    }));
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({
          sectionRevisions: { quality: 1 },
          qualityRule: { enabled: true, entries },
        }),
        update_from_agent: update,
      },
      cache: create_cache([{ src: "AB" }]),
      computeWorker: create_compute_worker(),
    });
    const tool = find_tool(tools, "update_quality_rules");

    await expect(
      tool.execute(
        "duplicate",
        {
          rule_type: "glossary",
          write: [
            { entry_id: "a", entry: { src: "AB", dst: "甲", info: "", case_sensitive: false } },
            { entry: { src: "AB", dst: "甲", info: "", case_sensitive: false } },
          ],
          expected_section_revisions: { quality: 1 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow(/quality_rule\.duplicate_final_entry.*write\[0\].*write\[1\]/u);
    expect(update).not.toHaveBeenCalled();

    entries = [stored_entry("a", "A", "甲"), stored_entry("b", "a", "乙")];
    await expect(
      tool.execute(
        "cleanup",
        {
          rule_type: "glossary",
          delete: ["b"],
          expected_section_revisions: { quality: 1 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toMatchObject({ details: { status: "applied", revision: 2, deleted: ["b"] } });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("内容和顺序均未变化时不写入也不推进 revision", async () => {
    const update = vi.fn();
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({
          sectionRevisions: { quality: 4 },
          qualityRule: {
            enabled: true,
            entries: [stored_entry("a", "A", "甲"), stored_entry("b", "B", "乙")],
          },
        }),
        update_from_agent: update,
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });

    await expect(
      find_tool(tools, "update_quality_rules").execute(
        "unchanged",
        {
          rule_type: "glossary",
          write: [
            {
              entry_id: "a",
              entry: { src: "A", dst: "甲", info: "其他", case_sensitive: false },
            },
          ],
          move: [{ entry_id: "a", before_entry_id: "b" }],
          expected_section_revisions: { quality: 4 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toMatchObject({ details: { status: "unchanged", revision: 4 } });
    expect(update).not.toHaveBeenCalled();
  });

  it("revision 冲突返回当前事实和确定的重新查询动作", async () => {
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({
          sectionRevisions: { quality: 3 },
          qualityRule: { enabled: true, entries: [stored_entry("a", "A", "甲")] },
        }),
        update_from_agent: async () => {
          throw new RevisionConflictError({
            public_details: { section: "quality", expected_revision: 2, current_revision: 3 },
          });
        },
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });

    await expect(
      find_tool(tools, "update_quality_rules").execute(
        "revision-conflict",
        {
          rule_type: "glossary",
          delete: ["a"],
          expected_section_revisions: { quality: 2 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({
      details: {
        code: "data.revision_conflict",
        section: "quality",
        expected_revision: 2,
        current_revision: 3,
        action: "query_quality_rules",
      },
    });
  });

  it("事实已改变但写入口缺少确认时要求重新查询", async () => {
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({
          sectionRevisions: { quality: 1 },
          qualityRule: { mode: "custom", entries: [{ entry_id: "a", src: "A", info: "" }] },
        }),
        update_from_agent: async () => ({ accepted: true, changes: [] }),
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });

    await expect(
      find_tool(tools, "update_quality_rules").execute(
        "missing-confirmation",
        {
          rule_type: "text_preserve",
          delete: ["a"],
          expected_section_revisions: { quality: 1 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toMatchObject({
      details: {
        code: "quality_rule.write_not_confirmed",
        action: "query_quality_rules",
      },
    });
  });

  it("一次原子应用增删改与重排，保留既有身份并按动作返回确认", async () => {
    let revision = 2;
    const original_entries = [
      stored_entry("a", "Alpha", "甲"),
      stored_entry("b", "Beta", "乙"),
      stored_entry("c", "Gamma", "丙"),
    ];
    let entries = original_entries;
    const update = vi.fn(async (request: JsonRecord): Promise<ProjectWriteResult> => {
      if ((request["expected_section_revisions"] as JsonRecord)["quality"] !== revision) {
        throw new Error("revision conflict");
      }
      entries = structuredClone(request["entries"] as JsonRecord[]);
      revision += 1;
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
    });
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({
          projectPath: "test.lg",
          sectionRevisions: { quality: revision },
          qualityRule: { enabled: true, entries },
        }),
        update_from_agent: update,
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });
    const tool = find_tool(tools, "update_quality_rules");

    await expect(
      tool.execute(
        "conflict",
        {
          rule_type: "glossary",
          write: [
            {
              entry_id: "a",
              entry: { src: "Alpha Prime", dst: "A", info: "", case_sensitive: false },
            },
          ],
          expected_section_revisions: { quality: 1 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("revision conflict");

    const result = await tool.execute(
      "success",
      {
        rule_type: "glossary",
        write: [
          {
            entry: { src: "Delta", dst: "德尔塔", info: "名称", case_sensitive: false },
            before_entry_id: "a",
          },
          {
            entry_id: "a",
            entry: { src: "Alpha Prime", dst: "A", info: "", case_sensitive: false },
          },
        ],
        delete: ["b"],
        move: [{ entry_id: "a", before_entry_id: null }],
        expected_section_revisions: { quality: 2 },
      },
      undefined,
      undefined,
      undefined as never,
    );
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ entry_id: expect.stringMatching(/^qr:/u), src: "Delta" }),
          expect.objectContaining({ entry_id: "c", src: "Gamma" }),
          expect.objectContaining({ entry_id: "a", src: "Alpha Prime", dst: "A" }),
        ],
      }),
      AGENT_QUALITY_RULE_UPDATE_SOURCE,
    );
    const result_details = result.details as JsonRecord;
    expect(result_details).toMatchObject({
      status: "applied",
      revision: 3,
      created: [{ write_index: 0, entry_id: expect.stringMatching(/^qr:/u) }],
      updated: ["a"],
      deleted: ["b"],
      moved: ["a"],
    });
    expect(result_details).not.toHaveProperty("projectPath");
    expect(result_details).not.toHaveProperty("updated_entries");
    expect(original_entries.map((entry) => entry["entry_id"])).toEqual(["a", "b", "c"]);
  });
});

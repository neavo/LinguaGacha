import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import { QUALITY_RULE_KINDS } from "../../domain/quality";
import type { ProjectWriteResult } from "../../shared/project-event";
import {
  AGENT_QUALITY_RULE_UPDATE_SOURCE,
  apply_agent_quality_rule_changes,
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

describe("Agent 质量规则工具", () => {
  it("更新工具公开普通 object 根 schema，并只串行写入口", () => {
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
    const update_tool = tools.find((tool) => tool.name === "update_quality_rules");
    if (update_tool === undefined) throw new Error("缺少 update_quality_rules");
    const parameters = update_tool.parameters as JsonRecord;
    const properties = parameters["properties"] as JsonRecord;
    const changes = properties["changes"] as JsonRecord;
    const change_items = changes["items"] as JsonRecord;
    const change_properties = change_items["properties"] as JsonRecord;

    expect(parameters).toMatchObject({
      type: "object",
      required: ["rule_type", "expected_section_revisions"],
      additionalProperties: false,
    });
    expect(parameters).not.toHaveProperty("anyOf");
    expect(parameters).not.toHaveProperty("oneOf");
    expect(parameters).not.toHaveProperty("allOf");
    expect(Object.keys(properties)).toEqual([
      "rule_type",
      "changes",
      "meta",
      "expected_section_revisions",
    ]);
    expect(properties["rule_type"]).toMatchObject({
      type: "string",
      enum: QUALITY_RULE_KINDS,
    });
    expect(change_items).toMatchObject({ type: "object", additionalProperties: false });
    expect(change_items).not.toHaveProperty("anyOf");
    expect(change_items).not.toHaveProperty("oneOf");
    expect(change_items).not.toHaveProperty("allOf");
    expect(change_properties["action"]).toMatchObject({
      type: "string",
      enum: ["create", "update", "delete"],
    });
    expect(update_tool).not.toHaveProperty("constrainedSampling");
  });

  it("SDK 真实校验器接受所有稳定调用形状且不改写载荷", () => {
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({}),
        update_from_agent: async () => ({ accepted: true, changes: [] }),
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });
    const tool = tools.find((candidate) => candidate.name === "update_quality_rules");
    if (tool === undefined) throw new Error("缺少 update_quality_rules");
    const revision = { expected_section_revisions: { quality: 1 } };
    const payloads: JsonRecord[] = [
      {
        rule_type: "glossary",
        changes: [
          {
            action: "create",
            entry: { src: "A", dst: "甲", info: "名称", case_sensitive: false },
            before_entry_id: null,
          },
          {
            action: "update",
            entry_id: "a",
            entry: { src: "A", dst: "乙", info: "名称", case_sensitive: true },
          },
          { action: "delete", entry_id: "b" },
        ],
        meta: { enabled: true },
        ...revision,
      },
      {
        rule_type: "pre_replacement",
        changes: [
          {
            action: "create",
            entry: { src: "A", dst: "B", regex: false, case_sensitive: false },
          },
        ],
        ...revision,
      },
      {
        rule_type: "post_replacement",
        changes: [
          {
            action: "create",
            entry: { src: "A", dst: "B", regex: true, case_sensitive: true },
          },
        ],
        ...revision,
      },
      {
        rule_type: "text_preserve",
        changes: [{ action: "create", entry: { src: "\\\\N", info: "控制码" } }],
        meta: { mode: "custom" },
        ...revision,
      },
      { rule_type: "glossary", meta: { enabled: false }, ...revision },
      {
        rule_type: "text_preserve",
        changes: [{ action: "delete", entry_id: "keep" }],
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
      expect(validateToolArguments(tool, call)).toEqual(payload);
    }
  });

  it("SDK 真实校验器在执行前拒绝结构错误", () => {
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({}),
        update_from_agent: async () => ({ accepted: true, changes: [] }),
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });
    const tool = tools.find((candidate) => candidate.name === "update_quality_rules");
    if (tool === undefined) throw new Error("缺少 update_quality_rules");
    const validate = (payload: JsonRecord) =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "test-call",
        name: tool.name,
        arguments: payload,
      });

    let empty_error = "";
    try {
      validate({});
    } catch (error) {
      empty_error = error instanceof Error ? error.message : String(error);
    }
    expect(empty_error).toContain("rule_type");
    expect(empty_error).toContain("expected_section_revisions");
    expect(empty_error).not.toContain("anyOf");

    const base = {
      rule_type: "glossary",
      changes: [
        {
          action: "create",
          entry: { src: "A", dst: "甲", info: "", case_sensitive: false },
        },
      ],
      meta: { enabled: true },
      expected_section_revisions: { quality: 1 },
    };
    const invalid_payloads: JsonRecord[] = [
      { ...base, unknown: true },
      { ...base, changes: [{ ...base.changes[0], unknown: true }] },
      {
        ...base,
        changes: [{ ...base.changes[0], entry: { ...base.changes[0].entry, unknown: true } }],
      },
      { ...base, meta: { enabled: true, unknown: true } },
      { ...base, rule_type: [] },
      { ...base, rule_type: "unknown" },
      { ...base, expected_section_revisions: { quality: -1 } },
      { ...base, expected_section_revisions: { quality: 1.5 } },
    ];
    for (const payload of invalid_payloads) expect(() => validate(payload)).toThrow();
  });

  it("Agent 条件读取在快照、统计和持久化前拒绝非法字段组合", async () => {
    const query = vi.fn(() => ({
      projectPath: "test.lg",
      sectionRevisions: { quality: 1 },
      qualityRule: { enabled: true, entries: [] },
    }));
    const update = vi.fn(
      async (): Promise<ProjectWriteResult> => ({ accepted: true, changes: [] }),
    );
    const compute_worker = create_compute_worker();
    const compute = vi.spyOn(compute_worker, "run");
    const tools = create_agent_quality_tools({
      qualityRules: { query, update_from_agent: update },
      cache: create_cache([{ src: "A" }]),
      computeWorker: compute_worker,
    });
    const tool = tools.find((candidate) => candidate.name === "update_quality_rules");
    if (tool === undefined) throw new Error("缺少 update_quality_rules");
    const revision = { expected_section_revisions: { quality: 1 } };
    const invalid_payloads: JsonRecord[] = [
      {
        rule_type: "glossary",
        changes: [
          {
            action: "create",
            entry_id: "a",
            entry: { src: "A", dst: "甲", info: "", case_sensitive: false },
          },
        ],
        ...revision,
      },
      {
        rule_type: "glossary",
        changes: [
          {
            action: "update",
            entry: { src: "A", dst: "甲", info: "", case_sensitive: false },
          },
        ],
        ...revision,
      },
      { rule_type: "glossary", changes: [{ action: "update", entry_id: "a" }], ...revision },
      {
        rule_type: "glossary",
        changes: [
          {
            action: "delete",
            entry_id: "a",
            entry: { src: "A", dst: "甲", info: "", case_sensitive: false },
          },
        ],
        ...revision,
      },
      {
        rule_type: "glossary",
        changes: [{ action: "delete", entry_id: "a", before_entry_id: null }],
        ...revision,
      },
      {
        rule_type: "glossary",
        changes: [{ action: "create", entry: { src: "A", dst: "甲", info: "" } }],
        ...revision,
      },
      {
        rule_type: "glossary",
        changes: [
          {
            action: "create",
            entry: { src: "A", dst: "甲", info: "", regex: false, case_sensitive: false },
          },
        ],
        ...revision,
      },
      {
        rule_type: "pre_replacement",
        changes: [
          {
            action: "create",
            entry: { src: "A", dst: "B", case_sensitive: false },
          },
        ],
        ...revision,
      },
      {
        rule_type: "post_replacement",
        changes: [
          {
            action: "create",
            entry: { src: "A", dst: "B", info: "", regex: false, case_sensitive: false },
          },
        ],
        ...revision,
      },
      {
        rule_type: "text_preserve",
        changes: [
          {
            action: "create",
            entry: { src: "A", dst: "B", info: "", regex: false, case_sensitive: false },
          },
        ],
        ...revision,
      },
      { rule_type: "glossary", meta: { mode: "custom" }, ...revision },
      { rule_type: "text_preserve", meta: { enabled: true }, ...revision },
      { rule_type: "glossary", meta: {}, ...revision },
      { rule_type: "glossary", meta: { enabled: true, mode: "custom" }, ...revision },
      { rule_type: "glossary", changes: [], ...revision },
    ];

    for (const payload of invalid_payloads) {
      await expect(
        tool.execute("invalid", payload, undefined, undefined, undefined as never),
      ).rejects.toThrow();
    }
    expect(query).not.toHaveBeenCalled();
    expect(compute).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("查询四类规则，并为术语保留派生事实", async () => {
    const rules: Record<string, JsonRecord> = {
      glossary: {
        enabled: false,
        entries: [
          stored_entry("a", "白之城", "White City"),
          stored_entry("b", "白之城骑士", "Knight"),
          stored_entry("c", "白之城", "City"),
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

  it("在内存副本一次应用增删改和重排，并保留既有身份", () => {
    const current = [
      stored_entry("a", "Alpha", "甲"),
      stored_entry("b", "Beta", "乙"),
      stored_entry("c", "Gamma", "丙"),
      stored_entry("d", "Delta", "丁"),
    ];
    const next = apply_agent_quality_rule_changes({
      rule_type: "glossary",
      current_entries: current,
      changes: [
        {
          action: "update",
          entry_id: "a",
          entry: { src: "Alpha", dst: "阿尔法", info: "名称", case_sensitive: false },
        },
        { action: "delete", entry_id: "b" },
        {
          action: "update",
          entry_id: "d",
          entry: { src: "Delta", dst: "丁", info: "其他", case_sensitive: false },
          before_entry_id: "c",
        },
        {
          action: "create",
          entry: { src: "Epsilon", dst: "艾普西隆", info: "名称", case_sensitive: false },
        },
      ],
    });

    expect(next.entries.map((entry) => entry["entry_id"])).toEqual([
      "a",
      "d",
      "c",
      expect.stringMatching(/^qr:/u),
    ]);
    expect(next.entries[0]).toMatchObject({ dst: "阿尔法", entry_id: "a" });
    expect(current.map((entry) => entry["entry_id"])).toEqual(["a", "b", "c", "d"]);
  });

  it("任一非法变更都整批拒绝且不调用持久化入口", async () => {
    const update = vi.fn(
      async (): Promise<ProjectWriteResult> => ({ accepted: true, changes: [] }),
    );
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
    const tool = tools.find((candidate) => candidate.name === "update_quality_rules");
    if (tool === undefined) throw new Error("缺少 update_quality_rules");
    const base = { rule_type: "glossary", expected_section_revisions: { quality: 1 } };
    const invalid_changes = [
      [{ action: "delete", entry_id: "missing" }],
      [
        {
          action: "update",
          entry_id: "a",
          entry: { src: "Alpha", dst: "甲", info: "", case_sensitive: false },
          before_entry_id: "missing",
        },
      ],
      [
        {
          action: "update",
          entry_id: "a",
          entry: { src: "Alpha", dst: "甲", info: "", case_sensitive: false },
        },
        {
          action: "update",
          entry_id: "a",
          entry: { src: "Alpha", dst: "   ", info: "", case_sensitive: false },
        },
      ],
      [
        {
          action: "create",
          entry: { src: "Ghost", dst: "幽灵", info: "", case_sensitive: false },
        },
      ],
    ];
    for (const changes of invalid_changes) {
      await expect(
        tool.execute("invalid", { ...base, changes }, undefined, undefined, undefined as never),
      ).rejects.toThrow();
    }

    await expect(
      tool.execute(
        "invalid-regex",
        {
          rule_type: "text_preserve",
          changes: [{ action: "create", entry: { src: "[", info: "" } }],
          expected_section_revisions: { quality: 1 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("不是合法正则");
    expect(update).not.toHaveBeenCalled();
  });

  it("条目与 meta 同批提交，每次写入只统计一次 prospective 集合并返回有限确认", async () => {
    let revision = 2;
    let enabled = true;
    let entries = [stored_entry("a", "Alpha", "甲")];
    const update = vi.fn(async (request: JsonRecord): Promise<ProjectWriteResult> => {
      if ((request["expected_section_revisions"] as JsonRecord)["quality"] !== revision) {
        throw new Error("revision conflict");
      }
      entries = structuredClone(request["entries"] as JsonRecord[]);
      enabled = (request["meta"] as JsonRecord)["enabled"] === true;
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
    const compute_worker = create_compute_worker();
    const compute_run = vi.spyOn(compute_worker, "run");
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({
          projectPath: "test.lg",
          sectionRevisions: { quality: revision },
          qualityRule: { enabled, entries },
        }),
        update_from_agent: update,
      },
      cache: create_cache([{ src: "Alpha" }]),
      computeWorker: compute_worker,
    });
    const tool = tools.find((candidate) => candidate.name === "update_quality_rules");
    if (tool === undefined) throw new Error("缺少 update_quality_rules");

    await expect(
      tool.execute(
        "conflict",
        {
          rule_type: "glossary",
          changes: [
            {
              action: "update",
              entry_id: "a",
              entry: { src: "Alpha", dst: "A", info: "", case_sensitive: false },
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
        changes: [
          {
            action: "update",
            entry_id: "a",
            entry: { src: "Alpha", dst: "A", info: "", case_sensitive: false },
          },
        ],
        meta: { enabled: false },
        expected_section_revisions: { quality: 2 },
      },
      undefined,
      undefined,
      undefined as never,
    );
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entries: [expect.objectContaining({ entry_id: "a", dst: "A" })],
        meta: { enabled: false },
      }),
      AGENT_QUALITY_RULE_UPDATE_SOURCE,
    );
    const result_details = result.details as JsonRecord;
    expect(result_details).toMatchObject({
      sectionRevisions: { quality: 3 },
      meta: { enabled: false },
      affected_entries: [{ entry_id: "a", dst: "A" }],
    });
    expect(result_details).not.toHaveProperty("projectPath");
    expect((result_details["affected_entries"] as JsonRecord[])[0]).not.toHaveProperty(
      "matched_item_count",
    );
    expect(compute_run).toHaveBeenCalledTimes(2);
  });
});

import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
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

    expect(tools.map((tool) => tool.name)).toEqual([
      "query_quality_rules",
      "update_glossary_rules",
      "update_replacement_rules",
      "update_text_preserve_rules",
    ]);
    expect(tools.map((tool) => tool.executionMode)).toEqual([
      undefined,
      "sequential",
      "sequential",
      "sequential",
    ]);
  });

  it("SDK 真实校验器接受三个意图明确的写入形状且不改写载荷", () => {
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({}),
        update_from_agent: async () => ({ accepted: true, changes: [] }),
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });
    const revision = { expected_section_revisions: { quality: 1 } };
    const cases: Array<{ tool_name: string; payload: JsonRecord }> = [
      {
        tool_name: "update_glossary_rules",
        payload: {
          create_entries: [
            {
              entry: { src: "A", dst: "甲", info: "名称", case_sensitive: false },
              insert_before_entry_id: "b",
            },
          ],
          update_entries: [
            {
              entry_id: "a",
              new_entry: { src: "A-1", dst: "乙", info: "名称", case_sensitive: true },
              move_before_entry_id: null,
            },
          ],
          delete_entry_ids: ["b"],
          ...revision,
        },
      },
      {
        tool_name: "update_replacement_rules",
        payload: {
          rule_type: "pre_replacement",
          create_entries: [{ entry: { src: "A", dst: "B", regex: false, case_sensitive: false } }],
          ...revision,
        },
      },
      {
        tool_name: "update_replacement_rules",
        payload: {
          rule_type: "post_replacement",
          create_entries: [{ entry: { src: "A", dst: "B", regex: true, case_sensitive: true } }],
          ...revision,
        },
      },
      {
        tool_name: "update_text_preserve_rules",
        payload: {
          create_entries: [{ entry: { src: "\\\\N", info: "控制码" } }],
          ...revision,
        },
      },
      {
        tool_name: "update_text_preserve_rules",
        payload: { delete_entry_ids: ["keep"], ...revision },
      },
    ];

    for (const { tool_name, payload } of cases) {
      const tool = find_tool(tools, tool_name);
      const call: ToolCall = {
        type: "toolCall",
        id: "test-call",
        name: tool.name,
        arguments: payload,
      };
      expect(validateToolArguments(tool, call), `${tool_name}: ${JSON.stringify(payload)}`).toEqual(
        payload,
      );
    }
  });

  it("SDK 在执行前拒绝旧协议、设置写入、删除对象和跨规则字段", () => {
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({}),
        update_from_agent: async () => ({ accepted: true, changes: [] }),
      },
      cache: create_cache(),
      computeWorker: create_compute_worker(),
    });
    const revision = { expected_section_revisions: { quality: 1 } };
    const validate = (tool_name: string, payload: JsonRecord) =>
      validateToolArguments(find_tool(tools, tool_name), {
        type: "toolCall",
        id: "test-call",
        name: tool_name,
        arguments: payload,
      });
    const invalid_cases: Array<{ tool_name: string; payload: JsonRecord }> = [
      {
        tool_name: "update_glossary_rules",
        payload: {
          rule_type: "glossary",
          changes: [{ action: "delete", entry_id: "a" }],
          ...revision,
        },
      },
      { tool_name: "update_glossary_rules", payload: { enabled: false, ...revision } },
      { tool_name: "update_text_preserve_rules", payload: { mode: "custom", ...revision } },
      {
        tool_name: "update_glossary_rules",
        payload: {
          delete_entry_ids: [
            {
              entry_id: "a",
              entry: { src: "A", dst: "甲", info: "", case_sensitive: false },
            },
          ],
          ...revision,
        },
      },
      {
        tool_name: "update_glossary_rules",
        payload: {
          create_entries: [
            {
              entry: {
                src: "A",
                dst: "甲",
                info: "",
                regex: false,
                case_sensitive: false,
              },
            },
          ],
          ...revision,
        },
      },
      {
        tool_name: "update_replacement_rules",
        payload: {
          rule_type: "glossary",
          create_entries: [{ entry: { src: "A", dst: "B", regex: false, case_sensitive: false } }],
          ...revision,
        },
      },
      {
        tool_name: "update_replacement_rules",
        payload: {
          rule_type: "pre_replacement",
          create_entries: [
            {
              entry: { src: "A", dst: "B", info: "", regex: false, case_sensitive: false },
            },
          ],
          ...revision,
        },
      },
      {
        tool_name: "update_text_preserve_rules",
        payload: {
          create_entries: [{ entry: { src: "A", dst: "B", info: "" } }],
          ...revision,
        },
      },
    ];
    for (const test_case of invalid_cases) {
      expect(
        () => validate(test_case.tool_name, test_case.payload),
        `${test_case.tool_name}: ${JSON.stringify(test_case.payload)}`,
      ).toThrow();
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
      find_tool(tools, "update_glossary_rules").execute(
        "empty",
        { expected_section_revisions: { quality: 1 } },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("至少需要 create_entries、update_entries 或 delete_entry_ids");
    expect(query).not.toHaveBeenCalled();
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
    const glossary_tool = find_tool(tools, "update_glossary_rules");
    const revision = { expected_section_revisions: { quality: 1 } };
    const invalid_payloads = [
      { delete_entry_ids: ["missing"], ...revision },
      {
        update_entries: [
          {
            entry_id: "a",
            new_entry: { src: "Alpha", dst: "甲", info: "", case_sensitive: false },
            move_before_entry_id: "missing",
          },
        ],
        ...revision,
      },
      {
        update_entries: [
          {
            entry_id: "a",
            new_entry: { src: "Alpha", dst: "甲", info: "", case_sensitive: false },
          },
          {
            entry_id: "a",
            new_entry: { src: "Alpha", dst: "   ", info: "", case_sensitive: false },
          },
        ],
        ...revision,
      },
      {
        create_entries: [{ entry: { src: "Ghost", dst: "幽灵", info: "", case_sensitive: false } }],
        ...revision,
      },
    ];
    for (const payload of invalid_payloads) {
      await expect(
        glossary_tool.execute("invalid", payload, undefined, undefined, undefined as never),
        JSON.stringify(payload),
      ).rejects.toThrow();
    }

    const text_preserve_tool = find_tool(tools, "update_text_preserve_rules");
    await expect(
      text_preserve_tool.execute(
        "invalid-regex",
        {
          create_entries: [{ entry: { src: "[", info: "" } }],
          expected_section_revisions: { quality: 1 },
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("不是合法正则");
    expect(update).not.toHaveBeenCalled();
  });

  it("一次原子应用增删改与重排，保留既有身份并按动作返回确认", async () => {
    let revision = 2;
    const original_entries = [stored_entry("a", "Alpha", "甲"), stored_entry("b", "Beta", "乙")];
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
    const compute_worker = create_compute_worker();
    const compute_run = vi.spyOn(compute_worker, "run");
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({
          projectPath: "test.lg",
          sectionRevisions: { quality: revision },
          qualityRule: { enabled: true, entries },
        }),
        update_from_agent: update,
      },
      cache: create_cache([{ src: "Alpha Prime Delta" }]),
      computeWorker: compute_worker,
    });
    const tool = find_tool(tools, "update_glossary_rules");

    await expect(
      tool.execute(
        "conflict",
        {
          update_entries: [
            {
              entry_id: "a",
              new_entry: { src: "Alpha Prime", dst: "A", info: "", case_sensitive: false },
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
        create_entries: [
          {
            entry: { src: "Delta", dst: "德尔塔", info: "名称", case_sensitive: false },
            insert_before_entry_id: "a",
          },
        ],
        update_entries: [
          {
            entry_id: "a",
            new_entry: { src: "Alpha Prime", dst: "A", info: "", case_sensitive: false },
          },
        ],
        delete_entry_ids: ["b"],
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
          expect.objectContaining({ entry_id: "a", src: "Alpha Prime", dst: "A" }),
        ],
      }),
      AGENT_QUALITY_RULE_UPDATE_SOURCE,
    );
    const result_details = result.details as JsonRecord;
    expect(result_details).toMatchObject({
      sectionRevisions: { quality: 3 },
      created_entries: [{ entry_id: expect.stringMatching(/^qr:/u), src: "Delta" }],
      updated_entries: [{ entry_id: "a", src: "Alpha Prime", dst: "A" }],
      deleted_entry_ids: ["b"],
    });
    expect(result_details).not.toHaveProperty("projectPath");
    expect((result_details["updated_entries"] as JsonRecord[])[0]).not.toHaveProperty(
      "matched_item_count",
    );
    expect(original_entries.map((entry) => entry["entry_id"])).toEqual(["a", "b"]);
    expect(compute_run).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import type { ProjectWriteResult } from "../../shared/project-event";
import {
  AGENT_QUALITY_RULE_UPDATE_SOURCE,
  apply_agent_quality_rule_changes,
  create_agent_quality_tools,
  query_agent_quality_rules,
} from "./agent-quality-tools";

function create_cache(items: JsonRecord[] = []) {
  return { items: { readItems: () => items } };
}

function stored_entry(entry_id: string, src: string, dst: string): JsonRecord {
  return { entry_id, src, dst, info: "其他", regex: false, case_sensitive: false };
}

describe("Agent 质量规则工具", () => {
  it("所有工具公开 object 根 schema，并只串行写入口", () => {
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({}),
        update: async () => ({ accepted: true, changes: [] }),
      },
      cache: create_cache(),
    });

    expect(tools.map((tool) => tool.parameters)).toEqual([
      expect.objectContaining({ type: "object" }),
      expect.objectContaining({ type: "object" }),
    ]);
    expect(tools.map((tool) => tool.executionMode)).toEqual([undefined, "sequential"]);
  });

  it("查询四类规则，并为术语保留派生事实", () => {
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
        update: vi.fn(),
      },
      cache: create_cache([{ item_id: 1, src: "白之城骑士守护白之城", name_src: "白之城" }]),
    };

    expect(query_agent_quality_rules(dependencies, "pre_replacement")).toMatchObject({
      projectPath: "test.lg",
      sectionRevisions: { quality: 4 },
      meta: { enabled: true },
      entries: [{ entry_id: "pre", src: "A", dst: "B", regex: false }],
    });
    expect(query_agent_quality_rules(dependencies, "post_replacement")).toMatchObject({
      meta: { enabled: false },
      entries: [{ entry_id: "post", regex: true }],
    });
    expect(query_agent_quality_rules(dependencies, "text_preserve")).toMatchObject({
      meta: { mode: "custom" },
      entries: [{ entry_id: "keep", info: "控制码" }],
    });

    const glossary = query_agent_quality_rules(dependencies, "glossary");
    expect(glossary).toMatchObject({ meta: { enabled: false } });
    expect(glossary.entries[0]).toMatchObject({ exact_occurrences: 3, fact_violations: [] });
    expect((glossary["structure"] as JsonRecord)["duplicate_src_groups"]).toMatchObject([
      { entry_ids: ["a", "c"] },
    ]);
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
      corpus_items: [{ src: "Alpha Gamma Delta Epsilon" }],
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

    expect(next.map((entry) => entry["entry_id"])).toEqual([
      "a",
      "d",
      "c",
      expect.stringMatching(/^qr:/u),
    ]);
    expect(next[0]).toMatchObject({ dst: "阿尔法", entry_id: "a" });
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
        update,
      },
      cache: create_cache([{ src: "Alpha Beta" }]),
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

  it("条目与 meta 同批提交，成功后返回最新规范化快照", async () => {
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
      return { accepted: true, changes: [] };
    });
    const tools = create_agent_quality_tools({
      qualityRules: {
        query: () => ({
          projectPath: "test.lg",
          sectionRevisions: { quality: revision },
          qualityRule: { enabled, entries },
        }),
        update,
      },
      cache: create_cache([{ src: "Alpha" }]),
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
    expect(result.details).toMatchObject({
      sectionRevisions: { quality: 3 },
      meta: { enabled: false },
      entries: [{ entry_id: "a", dst: "A", exact_occurrences: 1 }],
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import type { ProjectWriteResult } from "../../shared/project-event";
import {
  apply_agent_glossary_changes,
  create_agent_glossary_tools,
  read_agent_glossary,
} from "./agent-glossary-tools";

function create_cache(items: JsonRecord[]) {
  return { items: { readItems: () => items } };
}

function make_entry(entry_id: string, src: string, dst: string) {
  return {
    entry_id,
    src,
    dst,
    info: "其他",
    regex: false,
    case_sensitive: false,
    exact_occurrences: 0,
    fact_violations: [],
  };
}

describe("Agent 术语工具", () => {
  it("读取术语时复用 GUI 判重与质量关系规则", () => {
    const service = {
      read: (): JsonRecord => ({
        sectionRevisions: { quality: 4 },
        qualityRule: {
          entries: [
            { entry_id: "a", src: "白之城", dst: "White City", info: "地名" },
            { entry_id: "b", src: "白之城骑士", dst: "Knight", info: "组织" },
            { entry_id: "c", src: "白之塔", dst: "White Tower", info: "地名" },
            { entry_id: "d", src: "白之城", dst: "City", info: "地名" },
          ],
        },
      }),
    };

    const result = read_agent_glossary({
      qualityRules: service,
      cache: create_cache([
        { item_id: 1, src: "白之城骑士守护着白之城与白之塔。", file_path: "a.txt", row_number: 1 },
      ]),
    });

    expect(result.entries).toHaveLength(4);
    expect(result["sectionRevisions"]).toEqual({ quality: 4 });
    const structure = result["structure"] as JsonRecord;
    expect(structure["duplicate_src_groups"]).toMatchObject([{ entry_ids: ["a", "d"] }]);
    expect(structure["containment_candidates"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ entry_id: "a", parents: ["白之城骑士"] })]),
    );
    expect(structure["root_candidates"]).toEqual(
      expect.arrayContaining([
        { root_candidate: "白之", members: ["白之城", "白之城骑士", "白之塔"] },
      ]),
    );
  });

  it("读取术语时返回 exact_occurrences 与三类 fact_violations", () => {
    const service = {
      read: (): JsonRecord => ({
        sectionRevisions: { quality: 1 },
        qualityRule: {
          entries: [
            { entry_id: "ok", src: "Alpha", dst: "阿尔法", info: "其他", case_sensitive: false },
            { entry_id: "exact", src: "Alpha", dst: "阿尔法", info: "其他", case_sensitive: true },
            { entry_id: "zero", src: "Ghost", dst: "幽灵", info: "其他", case_sensitive: false },
            { entry_id: "empty", src: "Beta", dst: "   ", info: "其他", case_sensitive: false },
            {
              entry_id: "rx",
              src: "Gamma",
              dst: "伽马",
              info: "其他",
              regex: true,
              case_sensitive: false,
            },
          ],
        },
      }),
    };

    const result = read_agent_glossary({
      qualityRules: service,
      cache: create_cache([
        { item_id: 1, src: "Alpha alpha BETA Gamma", file_path: "a.txt", row_number: 1 },
        { item_id: 2, src: "Alpha", file_path: "b.txt", row_number: 2 },
      ]),
    });

    const by_id = new Map(result.entries.map((entry) => [entry.entry_id, entry]));
    expect(by_id.get("ok")).toMatchObject({ exact_occurrences: 3, fact_violations: [] });
    expect(by_id.get("exact")).toMatchObject({ exact_occurrences: 2, fact_violations: [] });
    expect(by_id.get("zero")).toMatchObject({
      exact_occurrences: 0,
      fact_violations: ["zero_occurrence"],
    });
    expect(by_id.get("empty")).toMatchObject({ fact_violations: ["empty_dst"] });
    expect(by_id.get("rx")).toMatchObject({ fact_violations: ["regex_enabled"] });
  });

  it("一次性应用 create/update/delete 并在任何非法条目上拒绝整个计划", () => {
    const current = [make_entry("a", "Alpha", "阿尔法"), make_entry("b", "Beta", "贝塔")];
    const next = apply_agent_glossary_changes(current, [
      {
        action: "update",
        entry_id: "a",
        entry: { src: "Alpha", dst: "阿尔法改", info: "其他", case_sensitive: true },
      },
      { action: "delete", entry_id: "b" },
      {
        action: "create",
        entry: { src: "Gamma", dst: "伽马", info: "其他", case_sensitive: false },
      },
    ]);

    expect(next).toMatchObject([
      { entry_id: "a", dst: "阿尔法改", case_sensitive: true },
      { src: "Gamma", dst: "伽马" },
    ]);
    expect(next[1]?.entry_id).not.toBe("");
    expect(current).toHaveLength(2);
    expect(() =>
      apply_agent_glossary_changes(current, [
        {
          action: "create",
          entry: { src: "   ", dst: "空", info: "其他", case_sensitive: false },
        },
      ]),
    ).toThrow("src 去空白后不能为空");
  });

  it("写工具失败不改权威条目，成功后返回新 revision", async () => {
    let entries = [
      { entry_id: "a", src: "Alpha", dst: "阿尔法", info: "其他", case_sensitive: false },
    ];
    let revision = 2;
    const quality_rules = {
      read: (): JsonRecord => ({
        sectionRevisions: { quality: revision },
        qualityRule: { entries },
      }),
      save_rule_entries: vi.fn(async (request: JsonRecord): Promise<ProjectWriteResult> => {
        const expected = request["expected_section_revisions"] as JsonRecord;
        if (expected["quality"] !== revision) throw new Error("revision conflict");
        entries = (request["entries"] as typeof entries).map((entry) => ({ ...entry }));
        revision += 1;
        return { accepted: true, changes: [] };
      }),
    };
    const tools = create_agent_glossary_tools({
      qualityRules: quality_rules,
      cache: create_cache([{ item_id: 1, src: "Alpha", file_path: "a.txt", row_number: 1 }]),
      beginWrite: vi.fn(),
      endWrite: vi.fn(),
    });
    const write_tool = tools.find((tool) => tool.name === "write_glossary");
    if (write_tool === undefined) throw new Error("缺少 write_glossary");

    await expect(
      write_tool.execute("write-1", {
        changes: [
          {
            action: "update",
            entry_id: "a",
            entry: { src: "Alpha", dst: "A", info: "其他", case_sensitive: false },
          },
        ],
        expected_section_revisions: { quality: 1 },
      }),
    ).rejects.toThrow("revision conflict");
    expect(entries[0]?.dst).toBe("阿尔法");

    const result = await write_tool.execute("write-2", {
      changes: [
        {
          action: "update",
          entry_id: "a",
          entry: { src: "Alpha", dst: "A", info: "其他", case_sensitive: false },
        },
      ],
      expected_section_revisions: { quality: 2 },
    });
    expect(result.details).toMatchObject({
      sectionRevisions: { quality: 3 },
      entries: [{ entry_id: "a", dst: "A", exact_occurrences: 1 }],
    });
  });

  it("写工具拒绝空 dst 与语料零出现的 src，整计划失败且权威条目不变", async () => {
    const entries = [
      { entry_id: "a", src: "Alpha", dst: "阿尔法", info: "其他", case_sensitive: false },
    ];
    const quality_rules = {
      read: (): JsonRecord => ({ sectionRevisions: { quality: 1 }, qualityRule: { entries } }),
      save_rule_entries: vi.fn(
        async (): Promise<ProjectWriteResult> => ({ accepted: true, changes: [] }),
      ),
    };
    const tools = create_agent_glossary_tools({
      qualityRules: quality_rules,
      cache: create_cache([{ item_id: 1, src: "Alpha", file_path: "a.txt", row_number: 1 }]),
      beginWrite: vi.fn(),
      endWrite: vi.fn(),
    });
    const write_tool = tools.find((tool) => tool.name === "write_glossary");
    if (write_tool === undefined) throw new Error("缺少 write_glossary");

    await expect(
      write_tool.execute("w-empty", {
        changes: [
          {
            action: "update",
            entry_id: "a",
            entry: { src: "Alpha", dst: "   ", info: "其他", case_sensitive: false },
          },
        ],
        expected_section_revisions: { quality: 1 },
      }),
    ).rejects.toThrow("dst 去空白后不能为空");
    expect(quality_rules.save_rule_entries).not.toHaveBeenCalled();

    await expect(
      write_tool.execute("w-zero", {
        changes: [
          {
            action: "create",
            entry: { src: "Ghost", dst: "幽灵", info: "其他", case_sensitive: false },
          },
        ],
        expected_section_revisions: { quality: 1 },
      }),
    ).rejects.toThrow("零出现");
    expect(quality_rules.save_rule_entries).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
  });
});

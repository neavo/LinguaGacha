import { describe, expect, it } from "vitest";

import type { JsonRecord } from "../../domain/json";
import type { PromptKind } from "../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import {
  create_empty_agent_workspace_intent_batch,
  derive_agent_workspace_apply_status,
  project_agent_workspace_item,
  project_agent_workspace_prompt,
  project_agent_workspace_quality_entry,
  resolve_agent_workspace_writes,
  type AgentWorkspaceCurrentFacts,
  type AgentWorkspaceIntentBatch,
  type AgentWorkspaceQualityIntents,
} from "./agent-workspace-write";

describe("Agent 工作区对象写入规则", () => {
  it("三类对象生成稳定的 4 字符 fp，并对业务事实变化敏感", () => {
    const item = project_agent_workspace_item(create_item(42));
    const quality = project_agent_workspace_quality_entry(
      "glossary",
      quality_entry("A12BC", "姫", { dst: "公主", info: "称谓" }),
      2,
    );
    const prompt = project_agent_workspace_prompt("translation", "翻译提示词");

    expect(String(item["fp"])).toMatch(/^[\w-]{4}$/u);
    expect(project_agent_workspace_item(create_item(42))["fp"]).toBe(item["fp"]);
    expect(
      project_agent_workspace_quality_entry(
        "glossary",
        quality_entry("A12BC", "姫", {
          dst: "公主",
          info: "称谓",
        }),
        2,
      )["fp"],
    ).toBe(quality["fp"]);
    expect(project_agent_workspace_prompt("translation", "翻译提示词")["fp"]).toBe(prompt["fp"]);
    expect(project_agent_workspace_item({ ...create_item(42), dst: "王女" })["fp"]).not.toBe(
      item["fp"],
    );
  });

  it.each([
    [{}, [], "unchanged"],
    [{}, [{ scope: "items", op: "update", id: 1, reason: "invalid_change" }], "rejected"],
    [{ items: { updated: 1 } }, [], "applied"],
    [
      { items: { updated: 1 } },
      [{ scope: "items", op: "update", id: 2, reason: "fp_mismatch" }],
      "partial",
    ],
  ] as const)("按实际写入与拒绝组合推导 %s/%s 为 %s", (applied, rejected, status) => {
    expect(derive_agent_workspace_apply_status(applied, rejected)).toBe(status);
  });

  it("quality fp 不包含 sort 或其它 entry", () => {
    const entry = quality_entry("A", "姫");
    const first = project_agent_workspace_quality_entry("glossary", entry, 0);
    const moved = project_agent_workspace_quality_entry("glossary", entry, 8);

    expect(moved["fp"]).toBe(first["fp"]);
    expect(
      project_agent_workspace_quality_entry("glossary", { ...entry, dst: "王女" }, 0)["fp"],
    ).not.toBe(first["fp"]);
  });

  it("合并 item 的不同字段并按对象拒绝异值冲突", () => {
    const current = create_item(1);
    const fp = item_fp(current);
    const merged = resolve(
      batch({
        items: [
          { line: 1, item_id: 1, fp, update: { dst: "译文" } },
          { line: 2, item_id: 1, fp, update: { status: "EXCLUDED" } },
        ],
      }),
      { items: [current], quality: {}, prompts: {} },
    );
    const conflict = resolve(
      batch({
        items: [
          { line: 1, item_id: 1, fp, update: { dst: "甲" } },
          { line: 2, item_id: 1, fp, update: { dst: "乙" } },
        ],
      }),
      { items: [current], quality: {}, prompts: {} },
    );

    expect(merged.itemChanges).toHaveLength(1);
    expect(merged.itemChanges[0]?.next).toMatchObject({
      dst: "译文",
      status: "EXCLUDED",
      retry_count: 0,
    });
    expect(conflict.itemChanges).toEqual([]);
    expect(conflict.rejected).toEqual([
      { scope: "items", op: "update", id: 1, reason: "merge_conflict" },
    ]);
  });

  it("Item 意图的预演包含同文组被动变化", () => {
    const representative = { ...create_item(1), dst: "", status: "NONE", retry_count: 0 };
    const duplicate = { ...create_item(2), dst: "", status: "DUPLICATED", retry_count: 0 };
    const result = resolve_agent_workspace_writes({
      batch: batch({
        items: [
          {
            line: 1,
            item_id: 1,
            fp: item_fp(representative),
            update: { status: "EXCLUDED" },
          },
        ],
      }),
      current: {
        items: [representative, duplicate],
        quality: {},
        prompts: {},
        duplicateFilterEnabled: true,
      },
    });

    expect(result.applied.items).toEqual({ updated: 2 });
    expect(result.itemChanges.map(({ item_id, next }) => [item_id, next.status])).toEqual([
      [1, "EXCLUDED"],
      [2, "NONE"],
    ]);
    expect(result.candidates.items).toHaveLength(1);
  });

  it("prompt 同值去重、异值冲突并独立保留其它 kind", () => {
    const translation_fp = prompt_fp("translation", "旧翻译");
    const analysis_fp = prompt_fp("analysis", "旧分析");
    const result = resolve(
      batch({
        prompts: [
          { line: 1, kind: "translation", fp: translation_fp, text: "新翻译" },
          { line: 2, kind: "translation", fp: translation_fp, text: "另一个翻译" },
          { line: 3, kind: "analysis", fp: analysis_fp, text: "新分析" },
          { line: 4, kind: "analysis", fp: analysis_fp, text: "新分析" },
        ],
      }),
      { items: [], quality: {}, prompts: { translation: "旧翻译", analysis: "旧分析" } },
    );

    expect(result.promptChanges).toEqual([{ kind: "analysis", text: "新分析" }]);
    expect(result.rejected).toContainEqual({
      scope: "prompts",
      op: "update",
      kind: "translation",
      reason: "merge_conflict",
    });
  });

  it("delete 决定既有 quality 最终不存在且无关 create 仍可提交", () => {
    const current = [quality_entry("A", "甲"), quality_entry("B", "乙")];
    const result = resolve(
      batch({
        quality: {
          glossary: {
            creates: [quality_create(3, "丙", -1)],
            updates: [quality_update(1, "A", quality_fp("glossary", current[0]!), { dst: "新" })],
            deletes: [quality_delete(2, "A", quality_fp("glossary", current[0]!))],
          },
        },
      }),
      { items: [], quality: { glossary: current }, prompts: {} },
    );

    expect(result.applied.quality?.glossary).toEqual({ created: 1, updated: 0, deleted: 1 });
    expect(result.qualityChanges[0]?.entries.map((entry) => entry["src"])).toEqual(["乙", "丙"]);
  });

  it("按 sort 稳定处理首插、尾插、越界和同索引 update 优先", () => {
    const current = [quality_entry("A", "甲"), quality_entry("B", "乙"), quality_entry("C", "丙")];
    const result = resolve(
      batch({
        quality: {
          glossary: {
            creates: [quality_create(4, "同位创建", 0), quality_create(5, "尾部", 99)],
            updates: [quality_update(3, "C", quality_fp("glossary", current[2]!), {}, 0)],
            deletes: [],
          },
        },
      }),
      { items: [], quality: { glossary: current }, prompts: {} },
    );

    expect(result.qualityChanges[0]?.entries.map((entry) => entry["src"])).toEqual([
      "丙",
      "同位创建",
      "甲",
      "乙",
      "尾部",
    ]);
    expect(result.applied.quality?.glossary).toEqual({ created: 2, updated: 1, deleted: 0 });
  });

  it("并发前插后普通业务 update 保持当前位置，显式 sort 才移动", () => {
    const current = [quality_entry("X", "新"), quality_entry("A", "甲"), quality_entry("B", "乙")];
    const fp = quality_fp("glossary", current[1]!);
    const ordinary = resolve(
      batch({
        quality: {
          glossary: {
            creates: [],
            updates: [quality_update(1, "A", fp, { dst: "新译" })],
            deletes: [],
          },
        },
      }),
      { items: [], quality: { glossary: current }, prompts: {} },
    );
    const sorted = resolve(
      batch({
        quality: {
          glossary: {
            creates: [],
            updates: [quality_update(1, "A", fp, { dst: "新译" }, 0)],
            deletes: [],
          },
        },
      }),
      { items: [], quality: { glossary: current }, prompts: {} },
    );

    expect(ordinary.qualityChanges[0]?.entries.map((entry) => entry["entry_id"])).toEqual([
      "X",
      "A",
      "B",
    ]);
    expect(sorted.qualityChanges[0]?.entries.map((entry) => entry["entry_id"])).toEqual([
      "A",
      "X",
      "B",
    ]);
  });

  it("sort-only 真实移动计入 updated，同位置意图保持 unchanged", () => {
    const current = [quality_entry("A", "甲"), quality_entry("B", "乙")];
    const fp = quality_fp("glossary", current[0]!);
    const moved = resolve(
      batch({ quality: { glossary: quality_ops([quality_update(1, "A", fp, {}, -1)]) } }),
      { items: [], quality: { glossary: current }, prompts: {} },
    );
    const same = resolve(
      batch({ quality: { glossary: quality_ops([quality_update(1, "A", fp, {}, 0)]) } }),
      { items: [], quality: { glossary: current }, prompts: {} },
    );

    expect(moved.applied.quality?.glossary?.updated).toBe(1);
    expect(same.applied).toEqual({});
    expect(same.candidates.quality.glossary.updates).toEqual([]);
  });

  it("新增重复组只拒绝依赖组并保留无关 create", () => {
    const current = [quality_entry("A", "甲")];
    const result = resolve(
      batch({
        quality: {
          glossary: {
            creates: [quality_create(1, "甲", -1), quality_create(2, "乙", -1)],
            updates: [],
            deletes: [],
          },
        },
      }),
      { items: [], quality: { glossary: current }, prompts: {} },
    );

    expect(result.applied.quality?.glossary?.created).toBe(1);
    expect(result.qualityChanges[0]?.entries.map((entry) => entry["src"])).toEqual(["甲", "乙"]);
    expect(result.rejected).toContainEqual({
      scope: "quality",
      kind: "glossary",
      op: "create",
      src: "甲",
      reason: "invalid_change",
    });
  });

  it("被拒绝 delete 导致的重复依赖返回 dependency_conflict", () => {
    const current = [quality_entry("A", "甲"), quality_entry("B", "乙")];
    const result = resolve(
      batch({
        quality: {
          glossary: {
            creates: [],
            updates: [quality_update(2, "B", quality_fp("glossary", current[1]!), { src: "甲" })],
            deletes: [quality_delete(1, "A", "BAD_fp")],
          },
        },
      }),
      { items: [], quality: { glossary: current }, prompts: {} },
    );

    expect(result.applied).toEqual({});
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        { scope: "quality", kind: "glossary", op: "delete", id: "A", reason: "fp_mismatch" },
        {
          scope: "quality",
          kind: "glossary",
          op: "update",
          id: "B",
          reason: "dependency_conflict",
        },
      ]),
    );
  });

  it("同一 quality entry 同时 delete 与 update 时拒绝 update", () => {
    const current = [quality_entry("A", "甲")];
    const result = resolve(
      batch({
        quality: {
          glossary: {
            creates: [],
            updates: [quality_update(1, "A", quality_fp("glossary", current[0]!), { dst: "新" })],
            deletes: [quality_delete(2, "A", quality_fp("glossary", current[0]!))],
          },
        },
      }),
      { items: [], quality: { glossary: current }, prompts: {} },
    );

    expect(result.applied.quality?.glossary).toEqual({ created: 0, updated: 0, deleted: 1 });
    expect(result.rejected).toContainEqual({
      scope: "quality",
      kind: "glossary",
      op: "update",
      id: "A",
      reason: "merge_conflict",
    });
  });
});

function resolve(
  batch_value: AgentWorkspaceIntentBatch,
  current: Omit<AgentWorkspaceCurrentFacts, "duplicateFilterEnabled">,
) {
  return resolve_agent_workspace_writes({
    batch: batch_value,
    current: { ...current, duplicateFilterEnabled: false },
  });
}

function batch(args: {
  items?: AgentWorkspaceIntentBatch["items"];
  prompts?: AgentWorkspaceIntentBatch["prompts"];
  quality?: Partial<Record<QualityRuleKind, AgentWorkspaceQualityIntents>>;
}): AgentWorkspaceIntentBatch {
  const empty = create_empty_agent_workspace_intent_batch();
  return {
    items: args.items ?? [],
    prompts: args.prompts ?? [],
    quality: Object.fromEntries(
      QUALITY_RULE_KINDS.map((kind) => [kind, args.quality?.[kind] ?? empty.quality[kind]]),
    ) as Record<QualityRuleKind, AgentWorkspaceQualityIntents>,
  };
}

function create_item(item_id: number): JsonRecord {
  return {
    item_id,
    src: "姫",
    dst: "公主",
    name_src: "",
    name_dst: "",
    file_path: "chapter.txt",
    text_type: "RENPY",
    row_number: 18,
    status: "PROCESSED",
    retry_count: 0,
  };
}

function quality_entry(id: string, src: string, extra: JsonRecord = {}): JsonRecord {
  return {
    entry_id: id,
    src,
    dst: String(extra["dst"] ?? src),
    info: String(extra["info"] ?? ""),
    case_sensitive: false,
  };
}

function quality_create(line: number, src: string, sort: number) {
  return {
    line,
    kind: "glossary" as const,
    fields: { src, dst: src, info: "", case_sensitive: false },
    sort,
  };
}

function quality_update(line: number, id: string, fp: string, fields: JsonRecord, sort?: number) {
  return {
    line,
    kind: "glossary" as const,
    id,
    fp,
    fields,
    ...(sort === undefined ? {} : { sort }),
  };
}

function quality_delete(line: number, id: string, fp: string) {
  return { line, kind: "glossary" as const, id, fp };
}

function quality_ops(updates: ReturnType<typeof quality_update>[]): AgentWorkspaceQualityIntents {
  return { creates: [], updates, deletes: [] };
}

function item_fp(item: JsonRecord): string {
  return String(project_agent_workspace_item(item)["fp"]);
}

function quality_fp(kind: QualityRuleKind, entry: JsonRecord): string {
  return String(project_agent_workspace_quality_entry(kind, entry, 0)["fp"]);
}

function prompt_fp(kind: PromptKind, text: string): string {
  return String(project_agent_workspace_prompt(kind, text)["fp"]);
}

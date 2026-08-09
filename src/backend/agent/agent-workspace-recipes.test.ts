import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { JsonRecord, JsonValue } from "../../domain/json";

// recipe 是直接发布给模型阅读的源码；测试从真实资源路径执行，避免另建测试实现。
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<JsonValue>;

describe("Agent 工作区内置 recipes", () => {
  it("query-items 组合过滤、NFKC 搜索、分页并按独立开关联结 warning", async () => {
    const files = {
      "contract.json": contract(),
      "items/entries.jsonl": [
        item(1, { src: "Alice", file_path: "a.txt" }),
        item(2, { src: "Alice", file_path: "a.txt" }),
        item(3, { src: "Alice", file_path: "a.txt", status: "PROCESSED" }),
      ],
      "items/warnings.jsonl": [
        { item_id: 1, warnings: ["GLOSSARY"], glossary_applications: [{ entry_id: "g-1" }] },
        { item_id: 2, warnings: ["GLOSSARY"], glossary_applications: [{ entry_id: "g-2" }] },
      ],
    } satisfies Record<string, JsonValue>;
    const args = {
      filters: { statuses: ["NONE"], file_paths: ["a.txt"], warning_types: ["GLOSSARY"] },
      search: { keywords: [" ＡＬＩＣＥ ", "alice"], scope: "src" },
      offset: 0,
      limit: 1,
    };

    await expect(run_recipe("query-items", args, files)).resolves.toEqual({
      total_item_count: 2,
      items: [expect.objectContaining({ item_id: 1, matched_keywords: [" ＡＬＩＣＥ "] })],
      next_offset: 1,
    });
    await expect(
      run_recipe("query-items", { ...args, include_warnings: true }, files),
    ).resolves.toEqual({
      total_item_count: 2,
      items: [
        expect.objectContaining({
          item_id: 1,
          warning_evidence: expect.objectContaining({ warnings: ["GLOSSARY"] }),
        }),
      ],
      next_offset: 1,
    });
  });

  it("query-items 没有警告条件时不读取警告文件", async () => {
    await expect(
      run_recipe(
        "query-items",
        {},
        {
          "contract.json": contract(),
          "items/entries.jsonl": [item(1)],
        },
      ),
    ).resolves.toMatchObject({ total_item_count: 1 });
  });

  it("query-item-contexts 批量返回同文件前后各两条非空原文并合并重复条目", async () => {
    const result = await run_recipe(
      "query-item-contexts",
      { item_ids: [12, 14, 999] },
      {
        "contract.json": contract(),
        "items/entries.jsonl": [
          item(1, { src: "前文件", file_path: "before.txt" }),
          item(9, { src: "原文 9", file_path: "script.txt" }),
          item(10, { src: "  ", file_path: "script.txt" }),
          item(11, { src: "原文 11", file_path: "script.txt" }),
          item(12, { src: "原文 12", file_path: "script.txt" }),
          item(13, { src: "\t　", file_path: "script.txt" }),
          item(14, { src: "原文 14", file_path: "script.txt" }),
          item(15, { src: "原文 15", file_path: "script.txt" }),
          item(20, { src: "后文件", file_path: "after.txt" }),
        ],
      },
    );

    expect(result).toEqual({
      contexts: [
        { target_item_id: 12, item_ids: [9, 11, 12, 14, 15] },
        { target_item_id: 14, item_ids: [11, 12, 14, 15] },
      ],
      items: [
        expect.objectContaining({ item_id: 9 }),
        expect.objectContaining({ item_id: 11 }),
        expect.objectContaining({ item_id: 12 }),
        expect.objectContaining({ item_id: 14 }),
        expect.objectContaining({ item_id: 15 }),
      ],
      missing_item_ids: [999],
    });
  });

  it("query-quality-rule-groups 按完整关系组分页并区分目标与范围外证据", async () => {
    const result = await run_recipe(
      "query-quality-rule-groups",
      {
        kind: "glossary",
        keywords: ["姫", "孤立"],
        include_examples: true,
        offset: 0,
        limit: 1,
      },
      {
        "contract.json": contract(),
        "glossary/entries.jsonl": [
          { id: "g-1", src: "姫", dst: "公主", info: "", case_sensitive: false },
          { id: "g-2", src: "王女", dst: "殿下", info: "", case_sensitive: false },
          { id: "g-3", src: "孤立规则", dst: "结果", info: "", case_sensitive: false },
        ],
        "glossary/evidence.json": {
          by_id: {
            "g-1": { hits: 2, examples: ["姫の例句"], parent_sources: ["姫君"] },
            "g-2": { hits: 1, examples: ["王女の例句"], parent_sources: [] },
            "g-3": { hits: 4, examples: [], parent_sources: [] },
          },
          groups: [["g-1", "g-2"], ["g-3"]],
        },
      },
    );

    expect(result).toEqual({
      total_target_rule_count: 2,
      total_group_count: 2,
      groups: [{ target_ids: ["g-1"], evidence_ids: ["g-2"] }],
      entries: [
        expect.objectContaining({ id: "g-1", hits: 2, examples: ["姫の例句"] }),
        expect.objectContaining({ id: "g-2", hits: 1, examples: ["王女の例句"] }),
      ],
      next_offset: 1,
    });
  });
});

/** 用真实发布源码和最小只读工作区 API 验证 recipe 的公开结果。 */
async function run_recipe(
  name: "query-items" | "query-item-contexts" | "query-quality-rule-groups",
  args: JsonRecord,
  files: Record<string, JsonValue>,
): Promise<JsonValue> {
  const source = fs.readFileSync(
    path.resolve("resource", "agent", "workspace", "recipes", `${name}.js`),
    "utf-8",
  );
  const workspace = {
    readJson: async (file_path: string) => files[file_path],
    readJsonl: async function* (file_path: string) {
      const rows = files[file_path];
      if (!Array.isArray(rows)) throw new Error(`缺少 ${file_path}`);
      for (const row of rows) yield row;
    },
  };
  return await new AsyncFunction("workspace", "args", source)(workspace, args);
}

/** 测试 contract 只声明当前 recipe 场景实际消费的数据路径。 */
function contract(): JsonRecord {
  return {
    datasets: {
      items: { path: "items/entries.jsonl" },
      warnings: { path: "items/warnings.jsonl" },
      glossary: { path: "glossary/entries.jsonl" },
      glossary_evidence: { path: "glossary/evidence.json" },
    },
  };
}

/** 构造完整条目，场景只覆盖与当前判断有关的字段。 */
function item(item_id: number, overrides: JsonRecord = {}): JsonRecord {
  return {
    item_id,
    src: `原文 ${item_id.toString()}`,
    name_src: "",
    dst: "",
    name_dst: "",
    status: "NONE",
    file_path: "script.txt",
    row_number: item_id,
    retry_count: 0,
    ...overrides,
  };
}

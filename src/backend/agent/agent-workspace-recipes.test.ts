import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { JsonRecord, JsonValue } from "../../domain/json";

// recipe 作为原始发布资源不夹带测试文件；此处从真实资源路径集中执行两个只读入口。
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<JsonValue>;

describe("Agent 工作区内置 recipes", () => {
  it("inspect-items 组合过滤、NFKC 搜索、分页并联结真实 warning", async () => {
    const result = await run_recipe(
      "inspect-items",
      {
        filters: { statuses: ["NONE"], file_paths: ["a.txt"], warning_types: ["GLOSSARY"] },
        search: { keywords: [" ＡＬＩＣＥ ", "alice"], scope: "src" },
        offset: 0,
        limit: 1,
      },
      {
        "contract.json": contract(),
        "editable/items.jsonl": [
          {
            item_id: 1,
            src: "Alice",
            name_src: "",
            dst: "",
            name_dst: "",
            status: "NONE",
            file_path: "a.txt",
          },
          {
            item_id: 2,
            src: "Alice",
            name_src: "",
            dst: "",
            name_dst: "",
            status: "NONE",
            file_path: "a.txt",
          },
          {
            item_id: 3,
            src: "Alice",
            name_src: "",
            dst: "",
            name_dst: "",
            status: "PROCESSED",
            file_path: "a.txt",
          },
        ],
        "derived/warnings.jsonl": [
          { item_id: 1, warnings: ["GLOSSARY"], glossary_applications: [{ entry_id: "g-1" }] },
          { item_id: 2, warnings: ["GLOSSARY"], glossary_applications: [{ entry_id: "g-2" }] },
        ],
      },
    );

    expect(result).toEqual({
      total_item_count: 2,
      items: [
        expect.objectContaining({
          item_id: 1,
          matched_keywords: [" ＡＬＩＣＥ "],
          warning_evidence: expect.objectContaining({ warnings: ["GLOSSARY"] }),
        }),
      ],
      next_offset: 1,
    });
  });

  it("inspect-quality 返回分页目标、代表证据和相交的完整结构组", async () => {
    const result = await run_recipe(
      "inspect-quality",
      {
        kind: "glossary",
        keywords: ["姫"],
        include_examples: true,
        offset: 0,
        limit: 1,
      },
      {
        "contract.json": contract(),
        "editable/quality/glossary.jsonl": [
          { id: "g-1", src: "姫", dst: "公主", info: "", case_sensitive: false },
          { id: "g-2", src: "姫君", dst: "殿下", info: "", case_sensitive: false },
          { id: "g-3", src: "城", dst: "城堡", info: "", case_sensitive: false },
        ],
        "derived/quality_analysis/glossary.json": {
          entry_ids: ["g-1", "g-2", "g-3"],
          hits_by_id: { "g-1": 2, "g-2": 1, "g-3": 4 },
          examples_by_id: { "g-1": [{ item_id: 1 }], "g-2": [{ item_id: 2 }] },
          relations: {
            subset_parents_by_id: { "g-1": ["g-2"] },
            groups: [["g-1", "g-2"], ["g-3"]],
          },
        },
      },
    );

    expect(result).toEqual({
      total_entry_count: 2,
      target_ids: ["g-1"],
      entries: [
        expect.objectContaining({ id: "g-1", hits: 2, examples: [{ item_id: 1 }] }),
        expect.objectContaining({ id: "g-2", hits: 1, examples: [{ item_id: 2 }] }),
      ],
      groups: [["g-1", "g-2"]],
      next_offset: 1,
    });
  });

  it("inspect-quality 保留不属于任何结构组的直接命中条目", async () => {
    const result = await run_recipe(
      "inspect-quality",
      { kind: "glossary", keywords: ["孤立"] },
      {
        "contract.json": contract(),
        "editable/quality/glossary.jsonl": [
          { id: "g-1", src: "孤立规则", dst: "结果", info: "", case_sensitive: false },
        ],
        "derived/quality_analysis/glossary.json": {
          entry_ids: ["g-1"],
          hits_by_id: { "g-1": 3 },
          examples_by_id: {},
          relations: { subset_parents_by_id: {}, groups: [] },
        },
      },
    );

    expect(result).toEqual({
      total_entry_count: 1,
      target_ids: ["g-1"],
      entries: [expect.objectContaining({ id: "g-1", hits: 3 })],
      groups: [],
    });
  });

  it("inspect-items 拒绝未知参数、非法枚举和越界分页", async () => {
    await expect(run_recipe("inspect-items", { limit: 101, unknown: true }, {})).rejects.toThrow();
    await expect(
      run_recipe(
        "inspect-items",
        { filters: { statuses: ["UNKNOWN"] } },
        {
          "contract.json": contract(),
        },
      ),
    ).rejects.toThrow();
  });

  it("inspect-quality 拒绝未知规则类型", async () => {
    await expect(
      run_recipe("inspect-quality", { kind: "unknown" }, { "contract.json": contract() }),
    ).rejects.toThrow();
  });
});

/** 用真实发布源码和最小只读工作区 API 验证 recipe 的公开结果。 */
async function run_recipe(
  name: "inspect-items" | "inspect-quality",
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

/** 测试 contract 只声明当前场景实际消费的路径与枚举。 */
function contract(): JsonRecord {
  return {
    datasets: {
      items: {
        path: "editable/items.jsonl",
        fields: { status: { values: ["NONE", "PROCESSED"] } },
      },
      warnings: {
        path: "derived/warnings.jsonl",
        fields: { warnings: { values: ["GLOSSARY"] } },
      },
      "quality.glossary": { path: "editable/quality/glossary.jsonl" },
      "quality_analysis.glossary": { path: "derived/quality_analysis/glossary.json" },
    },
  };
}

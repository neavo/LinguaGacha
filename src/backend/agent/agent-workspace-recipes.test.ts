import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { read_json_record, type JsonRecord, type JsonValue } from "../../domain/json";
import { AGENT_WORKSPACE_CONTRACT, AGENT_WORKSPACE_RECIPE_PATHS } from "./agent-workspace-contract";

// 内置 recipe 共用同一只读宿主契约；集中执行真实发布源码，避免复制夹具。
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<JsonValue>;

describe("Agent 工作区内置 recipes", () => {
  it("query-items 组合过滤、NFKC 搜索、分页并返回具名对象", async () => {
    const files = {
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

    const result = read_json_record(await execute_recipe("query-items", args, files));
    expect(result).toMatchObject({
      total_item_count: 2,
      next_offset: 1,
    });
    expect(result["items"]).toEqual([
      expect.objectContaining({ item_id: 1, matched_keywords: [" ＡＬＩＣＥ "] }),
    ]);

    const withWarnings = read_json_record(
      await execute_recipe("query-items", { ...args, include_warnings: true }, files),
    );
    expect(withWarnings["items"]).toEqual([
      expect.objectContaining({
        item_id: 1,
        warning_evidence: expect.objectContaining({ warnings: ["GLOSSARY"] }),
      }),
    ]);
  });

  it("query-items 无警告需求时不读取证据，缺失的可选警告使用 null", async () => {
    const files = {
      "items/entries.jsonl": [item(1)],
    } satisfies Record<string, JsonValue>;
    const result = read_json_record(await execute_recipe("query-items", {}, files));

    expect(result).toMatchObject({
      total_item_count: 1,
    });
    expect(result["items"]).toHaveLength(1);

    const withWarnings = read_json_record(
      await execute_recipe(
        "query-items",
        { include_warnings: true, limit: 1 },
        { ...files, "items/warnings.jsonl": [] },
      ),
    );
    expect((withWarnings["items"] as JsonRecord[])[0]).toMatchObject({
      item_id: 1,
      warning_evidence: null,
    });
  });

  it("query-item-contexts 保留具名关系并合并重复证据对象", async () => {
    const result = read_json_record(
      await execute_recipe(
        "query-item-contexts",
        { item_ids: [12, 14, 999] },
        {
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
      ),
    );

    expect(result).toMatchObject({
      contexts: [
        { target_item_id: 12, item_ids: [9, 11, 12, 14, 15] },
        { target_item_id: 14, item_ids: [11, 12, 14, 15] },
      ],
      missing_item_ids: [999],
    });
    expect((result["items"] as JsonRecord[]).map((entry) => entry["item_id"])).toEqual([
      9, 11, 12, 14, 15,
    ]);
  });

  it("query-items 拒绝空关键词", async () => {
    await expect(
      execute_recipe("query-items", { search: { keywords: [" "] } }, { "items/entries.jsonl": [] }),
    ).rejects.toThrow();
  });

  it("query-items 拒绝越界分页", async () => {
    await expect(
      execute_recipe("query-items", { limit: 101 }, { "items/entries.jsonl": [] }),
    ).rejects.toThrow();
  });

  it("query-item-contexts 完整处理显式目标，不套用发现查询的分页上限", async () => {
    const item_ids = Array.from({ length: 101 }, (_, index) => index + 1);

    await expect(
      execute_recipe("query-item-contexts", { item_ids }, { "items/entries.jsonl": [] }),
    ).resolves.toEqual({ contexts: [], items: [], missing_item_ids: item_ids });
  });

  it("derive-common-literal-roots 按可见字符长度稳定枚举全部公共连续片段", async () => {
    const result = read_json_record(
      await execute_recipe(
        "derive-common-literal-roots",
        { forms: ["ドトール家", "ドトール伯爵", "ドトール領"] },
        {},
      ),
    );
    const candidates = result["candidates"] as JsonRecord[];

    expect(candidates).toContainEqual({ root: "ドトール", grapheme_length: 4 });
    expect(candidates).toContainEqual({ root: "トール", grapheme_length: 3 });
    expect(candidates.map((candidate) => candidate["grapheme_length"])).toEqual(
      candidates
        .map((candidate) => candidate["grapheme_length"])
        .toSorted((left, right) => Number(left) - Number(right)),
    );
  });

  it("derive-common-literal-roots 以 NFKC、大小写和 grapheme 比较并保留首项写法", async () => {
    await expect(
      execute_recipe("derive-common-literal-roots", { forms: ["Ａe\u0301家", "aÉ領"] }, {}),
    ).resolves.toMatchObject({
      candidates: expect.arrayContaining([{ root: "Ａe\u0301", grapheme_length: 2 }]),
    });

    await expect(
      execute_recipe("derive-common-literal-roots", { forms: ["同じ", "同じ"] }, {}),
    ).rejects.toThrow("至少两个不同词形");
  });
});

/** 用真实发布源码和最小只读工作区 API 验证 recipe 的公开结果。 */
async function execute_recipe(
  name: keyof typeof AGENT_WORKSPACE_RECIPE_PATHS,
  args: JsonRecord,
  files: Record<string, JsonValue>,
): Promise<JsonValue> {
  const source = fs.readFileSync(
    path.resolve("resource", "agent", "workspace", "recipes", `${name}.js`),
    "utf-8",
  );
  const workspace = {
    contract: AGENT_WORKSPACE_CONTRACT,
    readJson: async (file_path: string) => files[file_path],
    iterateJsonl: async function* (file_path: string) {
      const rows = files[file_path];
      if (!Array.isArray(rows)) throw new Error(`缺少 ${file_path}`);
      for (const row of rows) yield row;
    },
  };
  return await new AsyncFunction(
    "workspace",
    "args",
    `${source}\nreturn await runRecipe(workspace, args);`,
  )(workspace, args);
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
    text_type: "NONE",
    row_number: item_id,
    retry_count: 0,
    ...overrides,
  };
}

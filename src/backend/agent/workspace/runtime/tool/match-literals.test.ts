import { read_json_record, type JsonRecord } from "../../../../../domain/json";
import { describe, expect, it } from "vitest";

import { AGENT_WORKSPACE_RUNTIME_POLICY } from "../policy";
import { execute_workspace_tool, workspace_item } from "./test-support";

describe("ws.tool.matchLiterals 数据工具", () => {
  it("按正式 Unicode casefold 语义汇总字段、并集和证据范围", async () => {
    await expect(
      execute_workspace_tool(
        "matchLiterals",
        {
          patterns: [
            { key: "folded", text: "STRASSE", case_sensitive: false },
            { key: "exact", text: "STRASSE", case_sensitive: true },
          ],
          examples_per_pattern: 2,
        },
        {
          "items/entries.jsonl": [
            workspace_item(1, { src: "Straße STRASSE", name_src: "straße" }),
            workspace_item(2, { src: "strasse" }),
            workspace_item(3, { src: "none" }),
          ],
        },
      ),
    ).resolves.toEqual({
      scanned_item_count: 3,
      matched_item_count: 2,
      patterns: [
        {
          key: "folded",
          next_offset: 2,
          matched_item_count: 2,
          field_item_counts: { src: 2, name_src: 1 },
          example_matches: [
            {
              item_id: 1,
              field: "src",
              ranges: [
                { start: 0, end: 6 },
                { start: 7, end: 14 },
              ],
            },
            { item_id: 1, field: "name_src", ranges: [{ start: 0, end: 6 }] },
          ],
        },
        {
          key: "exact",
          next_offset: null,
          matched_item_count: 1,
          field_item_counts: { src: 1, name_src: 0 },
          example_matches: [{ item_id: 1, field: "src", ranges: [{ start: 7, end: 14 }] }],
        },
      ],
    });
  });

  it("补充字符前的命中范围可直接切片原始字段", async () => {
    const src = "😀Straße";
    const result = await execute_workspace_tool(
      "matchLiterals",
      {
        patterns: [{ key: "term", text: "STRASSE", case_sensitive: false }],
      },
      { "items/entries.jsonl": [workspace_item(1, { src })] },
    );
    expect(result).toMatchObject({
      patterns: [{ example_matches: [{ ranges: [{ start: 2, end: 8 }] }] }],
    });
    expect(src.slice(2, 8)).toBe("Straße");
  });

  it("拒绝重复、空文本、缺失标志和越界证据数量", async () => {
    const valid = { key: "key", text: "A", case_sensitive: false };
    const cases: JsonRecord[] = [
      { patterns: [valid, { ...valid, text: "B" }] },
      { patterns: [{ ...valid, text: "" }] },
      { patterns: [{ key: "key", text: "A" }] },
      { patterns: [{ ...valid, offset: -1 }] },
      { patterns: [{ ...valid, offset: 0.5 }] },
      {
        patterns: [valid],
        examples_per_pattern: AGENT_WORKSPACE_RUNTIME_POLICY.literalMatchExamplesMax + 1,
      },
    ];
    for (const args of cases) {
      await expect(
        execute_workspace_tool("matchLiterals", args, { "items/entries.jsonl": [] }),
      ).rejects.toThrow();
    }
  });

  it("跨正文与姓名逐页读取超过样例上限的全部证据", async () => {
    const count = AGENT_WORKSPACE_RUNTIME_POLICY.literalMatchExamplesMax + 2;
    const items = Array.from({ length: count }, (_, index) =>
      workspace_item(index + 1, { src: "セラ王女とセラ教団", name_src: "セラ" }),
    );
    const matches: JsonRecord[] = [];
    let offset: number | null = 0;
    // 总字段数给出有界调用次数，回归时不会因游标不前进而挂起测试。
    for (let page = 0; offset !== null && page < count * 2; page += 1) {
      const result = await execute_workspace_tool(
        "matchLiterals",
        {
          patterns: [{ key: "root", text: "セラ", case_sensitive: true, offset }],
          examples_per_pattern: 3,
        },
        { "items/entries.jsonl": items },
      );
      expect(result).toMatchObject({
        scanned_item_count: count,
        matched_item_count: count,
        patterns: [
          { matched_item_count: count, field_item_counts: { src: count, name_src: count } },
        ],
      });
      const pattern = (read_json_record(result)["patterns"] as JsonRecord[])[0];
      const records = pattern["example_matches"] as JsonRecord[];
      expect(records.length).toBeLessThanOrEqual(3);
      matches.push(...records);
      offset = pattern["next_offset"] as number | null;
    }
    expect(offset).toBeNull();
    expect(matches.map(({ item_id, field }) => [item_id, field])).toEqual(
      items.flatMap(({ item_id }) => [
        [item_id, "src"],
        [item_id, "name_src"],
      ]),
    );
  });

  it("各模式独立续页，空匹配和越界偏移结束，纯计数保留证据入口", async () => {
    const files = {
      "items/entries.jsonl": [
        workspace_item(1, { src: "Alice", name_src: "Alice" }),
        workspace_item(2, { src: "Alice Bob" }),
      ],
    };
    await expect(
      execute_workspace_tool(
        "matchLiterals",
        {
          patterns: [
            { key: "alice", text: "Alice", case_sensitive: true, offset: 1 },
            { key: "bob", text: "Bob", case_sensitive: true },
            { key: "missing", text: "Carol", case_sensitive: true },
            { key: "past", text: "Alice", case_sensitive: true, offset: 9 },
          ],
          examples_per_pattern: 1,
        },
        files,
      ),
    ).resolves.toMatchObject({
      patterns: [
        { next_offset: 2, example_matches: [{ item_id: 1, field: "name_src" }] },
        { next_offset: null, example_matches: [{ item_id: 2, field: "src" }] },
        { next_offset: null, example_matches: [] },
        { next_offset: null, example_matches: [] },
      ],
    });
    await expect(
      execute_workspace_tool(
        "matchLiterals",
        {
          patterns: [{ key: "alice", text: "Alice", case_sensitive: true }],
          examples_per_pattern: 0,
        },
        files,
      ),
    ).resolves.toMatchObject({
      patterns: [{ matched_item_count: 2, next_offset: 0, example_matches: [] }],
    });
  });
});

import type { JsonRecord } from "../../../../../domain/json";
import { describe, expect, it } from "vitest";

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
          max_matches_per_pattern: 2,
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
          matches_complete: false,
          matched_item_count: 2,
          field_item_counts: { src: 2, name_src: 1 },
          matches: [
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
          matches_complete: true,
          matched_item_count: 1,
          field_item_counts: { src: 1, name_src: 0 },
          matches: [{ item_id: 1, field: "src", ranges: [{ start: 7, end: 14 }] }],
        },
      ],
    });
  });

  it("拒绝重复身份、空文本、缺失标志和无效证据上限", async () => {
    const valid = { key: "key", text: "A", case_sensitive: false };
    const cases: JsonRecord[] = [
      { patterns: [valid, { ...valid, text: "B" }] },
      { patterns: [{ ...valid, text: "" }] },
      { patterns: [{ key: "key", text: "A" }] },
      { patterns: [valid], max_matches_per_pattern: -1 },
      { patterns: [valid], max_matches_per_pattern: 0.5 },
    ];
    for (const args of cases) {
      await expect(
        execute_workspace_tool("matchLiterals", args, { "items/entries.jsonl": [] }),
      ).rejects.toThrow();
    }
  });

  it.each([undefined, 0, 1, 4, 200])(
    "证据上限 %s 保持完整计数与字段证据顺序",
    async (max_matches_per_pattern) => {
      const result = await execute_workspace_tool(
        "matchLiterals",
        {
          patterns: [
            { key: "alice", text: "Alice", case_sensitive: false },
            { key: "bob", text: "Bob", case_sensitive: true },
            { key: "missing", text: "Carol", case_sensitive: true },
          ],
          ...(max_matches_per_pattern === undefined ? {} : { max_matches_per_pattern }),
        },
        {
          "items/entries.jsonl": [
            workspace_item(1, { src: "Alice Alice", name_src: "ALICE" }),
            workspace_item(2, { src: "Alice Bob", name_src: "Alice" }),
          ],
        },
      );
      const alice_matches = [
        {
          item_id: 1,
          field: "src",
          ranges: [
            { start: 0, end: 5 },
            { start: 6, end: 11 },
          ],
        },
        { item_id: 1, field: "name_src", ranges: [{ start: 0, end: 5 }] },
        { item_id: 2, field: "src", ranges: [{ start: 0, end: 5 }] },
        { item_id: 2, field: "name_src", ranges: [{ start: 0, end: 5 }] },
      ];
      const limit = max_matches_per_pattern ?? Infinity;
      expect(result).toEqual({
        scanned_item_count: 2,
        matched_item_count: 2,
        patterns: [
          {
            key: "alice",
            matched_item_count: 2,
            field_item_counts: { src: 2, name_src: 2 },
            matches_complete: limit >= 4,
            matches: alice_matches.slice(0, limit),
          },
          {
            key: "bob",
            matched_item_count: 1,
            field_item_counts: { src: 1, name_src: 0 },
            matches_complete: limit >= 1,
            matches:
              limit === 0 ? [] : [{ item_id: 2, field: "src", ranges: [{ start: 6, end: 9 }] }],
          },
          {
            key: "missing",
            matched_item_count: 0,
            field_item_counts: { src: 0, name_src: 0 },
            matches_complete: true,
            matches: [],
          },
        ],
      });
    },
  );
});

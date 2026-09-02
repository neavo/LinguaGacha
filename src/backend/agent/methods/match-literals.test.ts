import { type JsonRecord } from "../../../domain/json";
import { describe, expect, it } from "vitest";

import { AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES } from "../workspace/contract";
import { execute_workspace_method, workspace_item } from "./test-support";

describe("workspace.matchLiterals 领域方法", () => {
  it("按正式 Unicode casefold 语义汇总字段、并集和证据范围", async () => {
    await expect(
      execute_workspace_method(
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
          matched_item_count: 1,
          field_item_counts: { src: 1, name_src: 0 },
          example_matches: [{ item_id: 1, field: "src", ranges: [{ start: 7, end: 14 }] }],
        },
      ],
    });
  });

  it("拒绝重复、空文本、缺失标志和越界证据数量", async () => {
    const valid = { key: "key", text: "A", case_sensitive: false };
    const cases: JsonRecord[] = [
      { patterns: [valid, { ...valid, text: "B" }] },
      { patterns: [{ ...valid, text: "" }] },
      { patterns: [{ key: "key", text: "A" }] },
      { patterns: [valid], examples_per_pattern: AGENT_WORKSPACE_MAX_LITERAL_MATCH_EXAMPLES + 1 },
    ];
    for (const args of cases) {
      await expect(
        execute_workspace_method("matchLiterals", args, { "items/entries.jsonl": [] }),
      ).rejects.toThrow();
    }
  });
});

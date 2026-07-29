import { describe, expect, it } from "vitest";

import type { JsonRecord } from "../../domain/json";
import { search_agent_corpus } from "./agent-corpus-tools";

describe("Agent 语料工具", () => {
  it("批量精确搜索按稳定游标覆盖全部原文语境", () => {
    const items: JsonRecord[] = [
      {
        item_id: 1,
        src: "Alpha Alpha 与 beta",
        name_src: "ALPHA",
        file_path: "a.txt",
        row_number: 2,
      },
      {
        item_id: 2,
        src: "beta",
        name_src: null,
        file_path: "b.txt",
        row_number: 7,
      },
    ];

    const first = search_agent_corpus(items, {
      patterns: ["alpha", "beta"],
      case_sensitive: false,
      limit: 1,
    });
    expect(first).toMatchObject({ complete: false, cursor: "1" });
    expect(first["results"]).toMatchObject([
      { pattern: "alpha", total_matches: 3, matched_context_count: 2, matched_item_count: 1 },
      { pattern: "beta", total_matches: 2, matched_context_count: 2, matched_item_count: 2 },
    ]);

    const all_contexts: unknown[] = [];
    let cursor: string | undefined;
    let complete = false;
    for (let page_index = 0; page_index < 10 && !complete; page_index += 1) {
      const page = search_agent_corpus(items, {
        patterns: ["alpha", "beta"],
        case_sensitive: false,
        cursor,
        limit: 1,
      });
      const results = page["results"] as Array<{ contexts: unknown[] }>;
      all_contexts.push(...results.flatMap((result) => result.contexts));
      cursor = typeof page["cursor"] === "string" ? page["cursor"] : undefined;
      complete = page["complete"] === true;
    }

    expect(complete).toBe(true);
    expect(all_contexts).toHaveLength(4);
    expect(all_contexts).toContainEqual({
      item_id: 1,
      file_path: "a.txt",
      row_number: 2,
      field: "src",
      src: "Alpha Alpha 与 beta",
    });
  });
});

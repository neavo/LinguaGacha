import { describe, expect, it } from "vitest";

import {
  count_name_field_rows,
  extract_name_field_rows,
  filter_name_field_rows,
} from "./name-field-extraction";

describe("name-field-extraction", () => {
  it("从 name_src 提取唯一姓名并用术语表回填译名", () => {
    const rows = extract_name_field_rows({
      items: [
        { item_id: 1, src: "Alice says hello", name_src: "Alice" },
        { item_id: 2, src: "Alice has a very long context line", name_src: ["Alice", "Bob"] },
      ],
      glossary_entries: [{ src: "Alice", dst: "爱丽丝" }],
    });

    expect(rows).toEqual([
      {
        id: "Alice",
        src: "Alice",
        dst: "爱丽丝",
        context: "Alice has a very long context line",
        status: "translated",
      },
      {
        id: "Bob",
        src: "Bob",
        dst: "",
        context: "Alice has a very long context line",
        status: "untranslated",
      },
    ]);
  });

  it("筛选、排序和计数只基于公开行模型", () => {
    const rows = [
      { id: "Bob", src: "Bob", dst: "", context: "Bob line", status: "untranslated" as const },
      {
        id: "Alice",
        src: "Alice",
        dst: "爱丽丝",
        context: "Alice line",
        status: "translated" as const,
      },
    ];

    expect(
      filter_name_field_rows({
        rows,
        filter_state: { keyword: "ali", scope: "src", is_regex: false },
        sort_state: { field: "src", direction: "ascending" },
      }),
    ).toEqual([rows[1]]);
    expect(count_name_field_rows(rows)).toEqual({
      total: 2,
      translated: 1,
      untranslated: 1,
      error: 0,
    });
  });
});

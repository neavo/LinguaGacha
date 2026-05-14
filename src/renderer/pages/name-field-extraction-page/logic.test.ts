import { describe, expect, it } from "vitest";

import {
  build_name_field_glossary_entries,
  delete_name_field_rows,
  extract_name_field_rows,
  filter_name_field_rows,
  parse_name_field_translation_result,
  preserve_name_field_row_translations,
  update_name_field_row_dst,
} from "@/pages/name-field-extraction-page/logic";
import type {
  NameFieldFilterState,
  NameFieldRow,
  NameFieldSortState,
} from "@/pages/name-field-extraction-page/types";

const EMPTY_SORT: NameFieldSortState = {
  field: null,
  direction: null,
};

function filter_state(patch: Partial<NameFieldFilterState>): NameFieldFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
    ...patch,
  };
}

describe("name-field extraction logic", () => {
  it("从 ProjectStore.items 提取字符串姓名并用术语表预填译文", () => {
    const rows = extract_name_field_rows({
      items: {
        "1": {
          item_id: 1,
          src: "Alice says hello",
          name_src: "Alice",
        },
      },
      glossary_entries: [
        {
          src: "Alice",
          dst: "爱丽丝",
        },
      ],
    });

    expect(rows).toEqual([
      {
        id: "Alice",
        src: "Alice",
        dst: "爱丽丝",
        context: "Alice says hello",
        status: "translated",
      },
    ]);
  });

  it("支持数组姓名并为同名保留最长上下文", () => {
    const rows = extract_name_field_rows({
      items: {
        "1": {
          item_id: 1,
          src: "short",
          name_src: ["Alice", "Bob"],
        },
        "2": {
          item_id: 2,
          src: "Alice has a much longer context",
          name_src: "Alice",
        },
      },
      glossary_entries: [],
    });

    expect(rows.find((row) => row.src === "Alice")?.context).toBe(
      "Alice has a much longer context",
    );
    expect(rows.find((row) => row.src === "Bob")?.context).toBe("short");
  });

  it("编辑译文会同步更新状态", () => {
    const rows: NameFieldRow[] = [
      {
        id: "Alice",
        src: "Alice",
        dst: "",
        context: "hello",
        status: "untranslated",
      },
    ];

    expect(update_name_field_row_dst(rows, "Alice", "爱丽丝")[0]?.status).toBe("translated");
    expect(update_name_field_row_dst(rows, "Alice", " ")[0]?.status).toBe("untranslated");
  });

  it("搜索和删除使用页面本地数据", () => {
    const rows: NameFieldRow[] = [
      {
        id: "Alice",
        src: "Alice",
        dst: "爱丽丝",
        context: "hello",
        status: "translated",
      },
      {
        id: "Bob",
        src: "Bob",
        dst: "",
        context: "world",
        status: "untranslated",
      },
    ];

    expect(
      filter_name_field_rows({
        rows,
        filter_state: filter_state({ keyword: "爱丽丝", scope: "dst" }),
        sort_state: EMPTY_SORT,
      }).map((row) => row.id),
    ).toEqual(["Alice"]);
  });

  it("全部搜索范围只匹配原文和译文", () => {
    const rows: NameFieldRow[] = [
      {
        id: "Alice",
        src: "Alice",
        dst: "",
        context: "hidden context token",
        status: "untranslated",
      },
    ];

    expect(
      filter_name_field_rows({
        rows,
        filter_state: filter_state({ keyword: "hidden", scope: "all" }),
        sort_state: EMPTY_SORT,
      }),
    ).toEqual([]);
  });

  it("支持按多选目标批量删除姓名行", () => {
    const rows: NameFieldRow[] = [
      {
        id: "Alice",
        src: "Alice",
        dst: "爱丽丝",
        context: "hello",
        status: "translated",
      },
      {
        id: "Bob",
        src: "Bob",
        dst: "",
        context: "world",
        status: "untranslated",
      },
      {
        id: "Carol",
        src: "Carol",
        dst: "",
        context: "again",
        status: "untranslated",
      },
    ];

    expect(delete_name_field_rows(rows, ["Alice", "Carol"]).map((row) => row.id)).toEqual(["Bob"]);
    expect(delete_name_field_rows(rows, []).map((row) => row.id)).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
  });

  it("导入术语表允许只包含原文的姓名条目", () => {
    const entries = build_name_field_glossary_entries([
      {
        id: "Alice",
        src: "Alice",
        dst: "爱丽丝",
        context: "hello",
        status: "translated",
      },
      {
        id: "Bob",
        src: "Bob",
        dst: "",
        context: "world",
        status: "untranslated",
      },
    ]);

    expect(entries).toEqual([
      {
        src: "Alice",
        dst: "爱丽丝",
        info: "",
        case_sensitive: false,
      },
      {
        src: "Bob",
        dst: "",
        info: "",
        case_sensitive: false,
      },
    ]);
  });

  it("重新提取同名条目时保留页面内非空译文", () => {
    const rows = preserve_name_field_row_translations({
      previous_rows: [
        {
          id: "Alice",
          src: "Alice",
          dst: "艾莉丝",
          context: "old context",
          status: "translated",
        },
        {
          id: "Bob",
          src: "Bob",
          dst: "",
          context: "old context",
          status: "untranslated",
        },
      ],
      extracted_rows: [
        {
          id: "Alice",
          src: "Alice",
          dst: "爱丽丝",
          context: "new context",
          status: "translated",
        },
        {
          id: "Bob",
          src: "Bob",
          dst: "鲍勃",
          context: "new context",
          status: "translated",
        },
      ],
    });

    expect(rows).toEqual([
      {
        id: "Alice",
        src: "Alice",
        dst: "艾莉丝",
        context: "new context",
        status: "translated",
      },
      {
        id: "Bob",
        src: "Bob",
        dst: "鲍勃",
        context: "new context",
        status: "translated",
      },
    ]);
  });

  it("解析模型姓名译文时支持括号格式和短文本兜底", () => {
    expect(parse_name_field_translation_result("【爱丽丝】")).toEqual({
      dst: "爱丽丝",
      status: "translated",
    });
    expect(parse_name_field_translation_result("爱丽丝")).toEqual({
      dst: "爱丽丝",
      status: "translated",
    });
    expect(parse_name_field_translation_result("第一行\n第二行")).toEqual({
      dst: "",
      status: "format-error",
    });
  });
});

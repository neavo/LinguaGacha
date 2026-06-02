import { describe, expect, it } from "vitest";

import {
  create_search_pattern,
  find_first_translation_replace,
  matches_translation_replace_target,
} from "./proofreading-search-replace";

describe("proofreading search replace", () => {
  it("按字面量替换正文中的首个可见命中", () => {
    const pattern = create_search_pattern("Magic", false);
    if (pattern === null) {
      throw new Error("搜索模式缺失");
    }

    expect(
      find_first_translation_replace({
        item: {
          item_id: 1,
          file_path: "chapter.txt",
          row_number: 1,
          src: "source",
          dst: "Magic 和 Magic",
          name_src: null,
          name_dst: null,
          status: "NONE",
          retry_count: 0,
          warnings: [],
          warning_fragments_by_code: {},
          applied_glossary_terms: [],
          failed_glossary_terms: [],
        },
        search_pattern: pattern,
        replacement: "魔法",
        is_regex: false,
      }),
    ).toEqual({ field: "dst", text: "魔法 和 Magic" });
  });

  it("正文没有变化时继续检查姓名译文", () => {
    const pattern = create_search_pattern("Name: (.+)", true);
    if (pattern === null) {
      throw new Error("搜索模式缺失");
    }

    expect(
      find_first_translation_replace({
        item: {
          item_id: 1,
          file_path: "chapter.txt",
          row_number: 1,
          src: "source",
          dst: "正文译文",
          name_src: null,
          name_dst: ["Name: Alice", "保留译名"],
          status: "PROCESSED",
          retry_count: 0,
          warnings: [],
          warning_fragments_by_code: {},
          applied_glossary_terms: [],
          failed_glossary_terms: [],
        },
        search_pattern: pattern,
        replacement: "$1",
        is_regex: true,
      }),
    ).toEqual({ field: "name_dst", text: "Alice" });
  });

  it("匹配替换目标时同时检查正文和姓名译文", () => {
    const pattern = create_search_pattern("Alice", false);

    expect(
      matches_translation_replace_target({
        item: {
          item_id: 1,
          file_path: "chapter.txt",
          row_number: 1,
          src: "source",
          dst: "正文译文",
          name_src: null,
          name_dst: ["Alice", "保留译名"],
          status: "NONE",
          retry_count: 0,
          warnings: [],
          warning_fragments_by_code: {},
          applied_glossary_terms: [],
          failed_glossary_terms: [],
        },
        search_pattern: pattern,
        keyword: "Alice",
      }),
    ).toBe(true);
  });
});

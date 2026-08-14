import { describe, expect, it } from "vitest";

import { Item } from "../../../domain/item";
import {
  group_items,
  should_preserve_epub_reading_layout,
  split_text_lines_for_items,
} from "./file-format-shared";

describe("file-format-shared", () => {
  it("按历史 splitlines 口径处理尾随换行", () => {
    expect(split_text_lines_for_items("甲\n乙\n")).toEqual(["甲", "乙"]);
    expect(
      split_text_lines_for_items(
        "甲\r\n乙\v丙\f丁\r戊\n己\x1c庚\x1d辛\x1e壬\x85癸\u2028子\u2029丑",
      ),
    ).toEqual(["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸", "子", "丑"]);
    expect(split_text_lines_for_items("")).toEqual([]);
  });

  it("按目标语言集中判断 EPUB 阅读排版保留策略", () => {
    expect(should_preserve_epub_reading_layout("JA")).toBe(true);
    expect(should_preserve_epub_reading_layout(" zh-hant ")).toBe(true);
    expect(should_preserve_epub_reading_layout("ZH_HANT")).toBe(false);
    expect(should_preserve_epub_reading_layout("ZH")).toBe(false);
  });

  it("按文件类型和文件路径分组条目", () => {
    const items = [
      Item.from_json({ src: "甲", file_type: "TXT", file_path: "a.txt" }),
      Item.from_json({ src: "乙", file_type: "MD", file_path: "b.md" }),
    ];

    expect([...group_items(items, "TXT").keys()]).toEqual(["a.txt"]);
  });
});

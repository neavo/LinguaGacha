import { describe, expect, it } from "vitest";
import path from "node:path";

import { Item } from "../../../domain/item";
import {
  build_bilingual_path,
  build_target_path,
  effective_export_text,
  group_items,
  should_preserve_epub_reading_layout,
  split_text_lines_for_items,
} from "./file-format-shared";

describe("file-format-shared", () => {
  it("按历史 splitlines 口径处理尾随换行", () => {
    expect(split_text_lines_for_items("甲\n乙\n")).toEqual(["甲", "乙"]);
    expect(split_text_lines_for_items("")).toEqual([]);
  });

  it("构造单语和双语导出路径时都沿用源文件名", () => {
    const config = { source_language: "JA", target_language: "ZH" };

    expect(build_target_path(config, "out", "script.txt")).toBe(path.join("out", "script.txt"));
    expect(build_bilingual_path("out", "script.txt")).toBe(path.join("out", "script.txt"));
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

  it("空译文导出时回退原文", () => {
    expect(effective_export_text(Item.from_json({ src: "原文", dst: "" }))).toBe("原文");
    expect(effective_export_text(Item.from_json({ src: "原文", dst: "译文" }))).toBe("译文");
  });
});

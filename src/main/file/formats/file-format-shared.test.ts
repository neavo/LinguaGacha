import { describe, expect, it } from "vitest";
import path from "node:path";

import { normalize_item } from "../../../base/item";
import {
  build_bilingual_path,
  build_target_path,
  effective_export_text,
  group_items,
  language_suffix,
  prepare_name_fields,
  split_text_lines_for_items,
} from "./file-format-shared";

describe("file-format-shared", () => {
  it("按历史 splitlines 口径处理尾随换行", () => {
    expect(split_text_lines_for_items("甲\n乙\n")).toEqual(["甲", "乙"]);
    expect(split_text_lines_for_items("")).toEqual([]);
  });

  it("根据语言配置构造单语和双语导出路径", () => {
    const config = { source_language: "JA", target_language: "ZH" };

    expect(language_suffix(config, "source")).toBe("ja");
    expect(build_target_path(config, "out", "script.txt")).toBe(path.join("out", "script.zh.txt"));
    expect(build_bilingual_path(config, "out", "script.txt")).toBe(
      path.join("out", "script.ja.zh.txt"),
    );
  });

  it("按文件类型和文件路径分组条目", () => {
    const items = [
      normalize_item({ src: "甲", file_type: "TXT", file_path: "a.txt" }),
      normalize_item({ src: "乙", file_type: "MD", file_path: "b.md" }),
    ];

    expect([...group_items(items, "TXT").keys()]).toEqual(["a.txt"]);
  });

  it("按多数译名准备 name_dst 字段", () => {
    const [first, second] = prepare_name_fields(
      [
        normalize_item({
          src: "台词1",
          name_src: "太郎",
          name_dst: "塔罗",
          file_type: "MESSAGEJSON",
        }),
        normalize_item({
          src: "台词2",
          name_src: "太郎",
          name_dst: "太郎译",
          file_type: "MESSAGEJSON",
        }),
      ],
      { source_language: "JA", target_language: "ZH" },
    );

    expect([first?.name_dst, second?.name_dst]).toEqual(["塔罗", "塔罗"]);
    expect(effective_export_text(normalize_item({ src: "原文", dst: "" }))).toBe("原文");
  });
});

import { describe, expect, it } from "vitest";

import {
  clear_item_translation_fields,
  has_item_translation_text,
  read_item_source_text_parts,
  read_item_translation_text_parts,
  read_translation_name_text,
} from "./item-text";

describe("item-text", () => {
  it("读取正文与字符串姓名文本并保留字段来源", () => {
    expect(
      read_item_source_text_parts({
        src: "正文",
        name_src: "Alice",
      }),
    ).toEqual([
      { field: "src", text: "正文" },
      { field: "name_src", text: "Alice" },
    ]);
    expect(
      read_item_translation_text_parts({
        dst: "译文",
        name_dst: "艾丽丝",
      }),
    ).toEqual([
      { field: "dst", text: "译文" },
      { field: "name_dst", text: "艾丽丝" },
    ]);
  });

  it("读取数组姓名时只消费第 0 槽", () => {
    expect(
      read_item_source_text_parts({
        src: "",
        name_src: ["", "Bob", "Carol"],
      }),
    ).toEqual([{ field: "src", text: "" }]);
    expect(
      read_item_translation_text_parts({
        dst: "",
        name_dst: ["鲍勃", "", "卡萝"],
      }),
    ).toEqual([
      { field: "dst", text: "" },
      { field: "name_dst", text: "鲍勃" },
    ]);
  });

  it("按正文译文或姓名译文判断是否有可清空文本", () => {
    expect(has_item_translation_text({ dst: "", name_dst: null })).toBe(false);
    expect(has_item_translation_text({ dst: "", name_dst: ["", "保留译名"] })).toBe(false);
    expect(has_item_translation_text({ dst: "正文译文", name_dst: null })).toBe(true);
  });

  it("清空译文时同时清空正文和整个姓名译文字段", () => {
    expect(
      clear_item_translation_fields({
        dst: "正文译文",
        name_dst: ["旧译名", "保留译名"],
        status: "PROCESSED",
      }),
    ).toEqual({
      dst: "",
      name_dst: null,
      status: "PROCESSED",
    });
  });

  it("姓名译文读取保持第 0 槽语义", () => {
    expect(read_translation_name_text(["", "鲍勃"])).toBe("");
    expect(read_translation_name_text(["艾丽丝", "鲍勃"])).toBe("艾丽丝");
    expect(read_translation_name_text(null)).toBe("");
  });
});

import { describe, expect, it } from "vitest";

import {
  are_item_name_fields_equal,
  has_item_name_text,
  read_optional_item_name_text,
  read_item_name_text,
  resolve_export_item_name,
  write_item_name_text,
} from "./item-name";

describe("item-name", () => {
  it("只读取字符串或数组第 0 槽姓名", () => {
    expect(read_item_name_text("Alice")).toBe("Alice");
    expect(read_item_name_text(["", "Bob"])).toBe("");
    expect(read_item_name_text(["Alice", "Bob"])).toBe("Alice");
    expect(read_item_name_text(null)).toBe("");
    expect(read_item_name_text(undefined)).toBe("");
  });

  it("按第 0 槽是否为空读取可见姓名", () => {
    expect(read_optional_item_name_text("Alice")).toBe("Alice");
    expect(read_optional_item_name_text("")).toBeNull();
    expect(has_item_name_text(["Alice", "Bob"])).toBe(true);
    expect(has_item_name_text(["", "Bob"])).toBe(false);
  });

  it("只写入数组第 0 槽并保留后续槽位", () => {
    expect(write_item_name_text(["Alice", "Bob"], "Alicia")).toEqual(["Alicia", "Bob"]);
    expect(write_item_name_text("Alice", "")).toBe("");
    expect(write_item_name_text(null, "Alicia")).toBe("Alicia");
  });

  it("导出开启译名写回时逐条优先使用第 0 槽译名", () => {
    expect(
      resolve_export_item_name({
        name_src: "太郎",
        name_dst: "塔罗",
        write_translated_name_fields_to_file: true,
      }),
    ).toBe("塔罗");
    expect(
      resolve_export_item_name({
        name_src: "太郎",
        name_dst: null,
        write_translated_name_fields_to_file: true,
      }),
    ).toBe("太郎");
    expect(
      resolve_export_item_name({
        name_src: ["太郎", "花子"],
        name_dst: ["塔罗", "不使用"],
        write_translated_name_fields_to_file: true,
      }),
    ).toEqual(["塔罗", "花子"]);
  });

  it("导出关闭译名写回时只使用源姓名事实", () => {
    expect(
      resolve_export_item_name({
        name_src: ["太郎", "花子"],
        name_dst: ["塔罗", "华子"],
        write_translated_name_fields_to_file: false,
      }),
    ).toEqual(["太郎", "花子"]);
  });

  it("按规范 JSON 形状比较姓名字段", () => {
    expect(are_item_name_fields_equal(null, undefined)).toBe(true);
    expect(are_item_name_fields_equal(["Alice"], ["Alice"])).toBe(true);
    expect(are_item_name_fields_equal(["Alice"], "Alice")).toBe(false);
  });
});

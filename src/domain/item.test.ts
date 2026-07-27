import { describe, expect, it } from "vitest";

import { build_project_item_persistent_records, Item } from "./item";

describe("item 基础模型", () => {
  it("规范化缺失字段并只接受当前状态域", () => {
    const item = Item.from_json({
      src: 123 as unknown as string,
      file_type: "KVJSON",
      status: "PROCESSED",
      row: 1.8,
    });

    expect(item).toEqual(
      expect.objectContaining({
        src: "123",
        dst: "",
        file_type: "KVJSON",
        text_type: "NONE",
        status: "PROCESSED",
        row: 1,
        retry_count: 0,
      }),
    );
  });

  it("把 Item 转回公开 JSON 字段并保留可选 id", () => {
    const item = Item.from_json({
      id: 5,
      src: "原文",
      dst: "译文",
      file_type: "TXT",
      file_path: "script.txt",
    });

    expect(item.to_json()).toEqual(
      expect.objectContaining({
        id: 5,
        src: "原文",
        dst: "译文",
        file_type: "TXT",
        file_path: "script.txt",
      }),
    );
  });

  it("导出有效译文并规范化 name 与状态", () => {
    expect(Item.from_json({ src: "原文", dst: "", file_type: "TXT" }).effective_dst()).toBe("原文");
    expect(Item.normalize_name_field(["名", 1, "别名"])).toEqual(["名", "别名"]);
    expect(Item.normalize_status("BROKEN")).toBe("NONE");
  });

  it("通用表格和 JSON 条目缺少 text_type 时复用共享引擎类型推断", () => {
    expect(Item.from_json({ src: "{i}Start{/i}", file_type: "KVJSON" }).text_type).toBe("RENPY");
    expect(Item.from_json({ src: "{中文正文}", file_type: "KVJSON" }).text_type).toBe("NONE");
    expect(Item.from_json({ src: "@12 你好", file_type: "XLSX" }).text_type).toBe("WOLF");
  });

  it("把公开条目集合按主键排序并转换成数据库字段", () => {
    const first = Item.from_json({
      id: 1,
      src: "第一行",
      row: 10,
      file_type: "TXT",
      file_path: "script.txt",
    }).to_public_json();
    const second = Item.from_json({
      id: 2,
      src: "第二行",
      row: 20,
      file_type: "TXT",
      file_path: "script.txt",
    }).to_public_json();

    const records = build_project_item_persistent_records({
      "2": second,
      "1": first,
    });

    expect(records.map((record) => [record.id, record.row])).toEqual([
      [1, 10],
      [2, 20],
    ]);
    expect(records[0]).not.toHaveProperty("item_id");
    expect(records[0]).not.toHaveProperty("row_number");
  });
});

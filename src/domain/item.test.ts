import { describe, expect, it } from "vitest";

import {
  build_project_item_persistent_records,
  create_item,
  build_project_item_public_record,
  collect_project_item_missing_public_fields,
  normalize_project_item_public_record,
  PROJECT_ITEM_PUBLIC_SCHEMA,
  PROJECT_ITEM_WRITE_SCHEMA,
} from "./item";
import { Check } from "typebox/value";

describe("条目数据契约", () => {
  it("公开和存储边界复制姓名数组，后续编辑不会修改上游快照", () => {
    const item = create_item({ id: 1, name_src: ["原名", "来源槽"], name_dst: ["译名", "译名槽"] });
    const public_record = build_project_item_public_record(item);
    const stored = build_project_item_persistent_records({ "1": public_record })[0]!;
    expect(Array.isArray(public_record.name_dst)).toBe(true);
    if (Array.isArray(public_record.name_dst)) public_record.name_dst[0] = "新译名";
    expect(item.name_dst).toEqual(["译名", "译名槽"]);
    expect(stored.name_dst).toEqual(["译名", "译名槽"]);
  });
  it("格式解析可以没有身份，公开条目必须有身份，私有数据可嵌套 JSON", () => {
    const item = create_item({ extra_field: { slots: [{ value: [null, true, 1, "正文"] }] } });
    expect(item).not.toHaveProperty("id");
    expect(Check(PROJECT_ITEM_WRITE_SCHEMA, item)).toBe(true);
    expect(Check(PROJECT_ITEM_PUBLIC_SCHEMA, build_project_item_public_record(item))).toBe(false);
    const record = build_project_item_public_record({ ...item, id: 1 });
    expect(Check(PROJECT_ITEM_PUBLIC_SCHEMA, record)).toBe(true);
    expect(normalize_project_item_public_record(record)).toEqual(record);
    for (const value of [undefined, Infinity, NaN, () => "invalid"]) {
      const invalid = { ...record, extra_field: { nested: [{ value }] } };
      expect(Check(PROJECT_ITEM_PUBLIC_SCHEMA, invalid)).toBe(false);
      expect(normalize_project_item_public_record(invalid)).toBeNull();
    }
  });

  it("缺失字段由 Schema 诊断，存储字段别名只在公开边界转换", () => {
    const record = create_item({ id: 2, row: 4, name_dst: ["姓名", "后续槽"] });
    const { dst, ...incomplete } = record;
    expect(dst).toBe("");
    expect(collect_project_item_missing_public_fields(incomplete)).toEqual(["dst"]);
    expect(normalize_project_item_public_record(incomplete)).toBeNull();
    expect(normalize_project_item_public_record(record)).toMatchObject({
      item_id: 2,
      row_number: 4,
      name_dst: ["姓名", "后续槽"],
    });
    expect(collect_project_item_missing_public_fields({})).toEqual(
      expect.arrayContaining(["item_id", "row_number", "name_src", "extra_field"]),
    );
  });
  it("从持久记录归一字段并序列化完整记录", () => {
    const item = create_item({
      id: 5,
      src: 123,
      name_src: ["名", 1, "别名"],
      file_type: "BROKEN",
      file_path: "script.json",
      status: "BROKEN",
      row: 1.8,
      retry_count: 3,
    });

    expect(item).toEqual({
      id: 5,
      src: "123",
      dst: "",
      name_src: ["名", "别名"],
      name_dst: null,
      extra_field: "",
      tag: "",
      row: 1,
      file_type: "NONE",
      file_path: "script.json",
      text_type: "NONE",
      status: "NONE",
      skip_internal_filter: false,
    });
    expect(build_project_item_public_record(item)).not.toHaveProperty("retry_count");
  });

  it("通用表格和 JSON 条目缺少 text_type 时复用共享引擎类型推断", () => {
    expect(create_item({ src: "{i}Start{/i}", file_type: "KVJSON" }).text_type).toBe("RENPY");
    expect(create_item({ src: "{中文正文}", file_type: "KVJSON" }).text_type).toBe("NONE");
    expect(create_item({ src: "@12 你好", file_type: "XLSX" }).text_type).toBe("WOLF");
  });

  it("把公开条目集合按主键排序并转换成数据库字段", () => {
    const first = build_project_item_public_record(
      create_item({
        id: 1,
        src: "第一行",
        row: 10,
        file_type: "TXT",
        file_path: "script.txt",
      }),
    );
    const second = build_project_item_public_record(
      create_item({
        id: 2,
        src: "第二行",
        row: 20,
        file_type: "TXT",
        file_path: "script.txt",
      }),
    );

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

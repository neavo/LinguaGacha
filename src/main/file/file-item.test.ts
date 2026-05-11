import { describe, expect, it } from "vitest";

import {
  effective_dst,
  item_to_json,
  normalize_file_item,
  normalize_name,
  normalize_status,
  read_json_record,
} from "./file-item";

describe("file-item", () => {
  it("规范化缺失字段并兼容历史状态", () => {
    const item = normalize_file_item({
      src: 123 as unknown as string,
      file_type: "KVJSON",
      status: "PROCESSED_IN_PAST" as never,
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
    const item = normalize_file_item({
      id: 5,
      src: "原文",
      dst: "译文",
      file_type: "TXT",
      file_path: "script.txt",
    });

    expect(item_to_json(item)).toEqual(
      expect.objectContaining({
        id: 5,
        src: "原文",
        dst: "译文",
        file_type: "TXT",
        file_path: "script.txt",
      }),
    );
  });

  it("导出有效译文并规范化 name 与 JSON record", () => {
    expect(effective_dst(normalize_file_item({ src: "原文", dst: "", file_type: "TXT" }))).toBe(
      "原文",
    );
    expect(normalize_name(["名", 1, "别名"])).toEqual(["名", "别名"]);
    expect(read_json_record({ ok: true })).toEqual({ ok: true });
    expect(read_json_record(["not-record"])).toEqual({});
    expect(normalize_status("PROCESSING")).toBe("NONE");
  });

  it("通用表格和 JSON 条目缺少 text_type 时复用共享引擎类型推断", () => {
    expect(normalize_file_item({ src: "{i}Start{/i}", file_type: "KVJSON" }).text_type).toBe(
      "RENPY",
    );
    expect(normalize_file_item({ src: "{中文正文}", file_type: "KVJSON" }).text_type).toBe("NONE");
    expect(normalize_file_item({ src: "@12 你好", file_type: "XLSX" }).text_type).toBe("WOLF");
  });
});

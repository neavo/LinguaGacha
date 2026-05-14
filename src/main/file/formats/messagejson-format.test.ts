import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Item } from "../../../base/item";
import { MESSAGEJSONFormat } from "./messagejson-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-messagejson-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("MESSAGEJSONFormat", () => {
  it("解析 name、names 和纯 message 条目且不预填译文", async () => {
    const format = new MESSAGEJSONFormat({ source_language: "JA", target_language: "ZH" });

    const items = await format.read_from_stream(
      new TextEncoder().encode(
        JSON.stringify([
          { name: "Alice", message: "msg1" },
          { names: ["Bob", 123, "Carol"], message: "msg2" },
          { message: "msg3" },
          { name: "skip" },
          "invalid",
        ]),
      ),
      "m.json",
    );

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.name_src)).toEqual(["Alice", ["Bob", "Carol"], null]);
    expect(items.map((item) => item.src)).toEqual(["msg1", "msg2", "msg3"]);
    expect(items.map((item) => item.dst)).toEqual(["", "", ""]);
    expect(
      items.every((item) => item.file_type === "MESSAGEJSON" && item.text_type === "KAG"),
    ).toBe(true);
  });

  it("非数组 JSON 不按 MESSAGEJSON 解析", async () => {
    const format = new MESSAGEJSONFormat({ source_language: "JA", target_language: "ZH" });

    await expect(
      format.read_from_stream(new TextEncoder().encode(JSON.stringify({ a: 1 })), "m.json"),
    ).resolves.toEqual([]);
  });

  it("空译文写回时回退原文", async () => {
    const format = new MESSAGEJSONFormat({ source_language: "JA", target_language: "ZH" });

    await format.write_to_path(
      [
        Item.from_json({
          src: "s1",
          dst: "",
          row: 1,
          file_type: "MESSAGEJSON",
          file_path: "message/a.json",
        }),
      ],
      {
        translated_path: temp_dir,
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(JSON.parse(fs.readFileSync(path.join(temp_dir, "message", "a.json"), "utf-8"))).toEqual([
      { message: "s1" },
    ]);
  });

  it("写回时按配置使用多数译名字段", async () => {
    const format = new MESSAGEJSONFormat({
      source_language: "JA",
      target_language: "ZH",
      write_translated_name_fields_to_file: true,
    });
    await format.write_to_path(
      [
        Item.from_json({
          dst: "m1",
          name_src: "hero",
          name_dst: "勇者",
          row: 1,
          file_type: "MESSAGEJSON",
          file_path: "message/a.json",
        }),
        Item.from_json({
          dst: "m2",
          name_src: "hero",
          name_dst: "英雄",
          row: 2,
          file_type: "MESSAGEJSON",
          file_path: "message/a.json",
        }),
        Item.from_json({
          dst: "m2b",
          name_src: "hero",
          name_dst: "勇者",
          row: 4,
          file_type: "MESSAGEJSON",
          file_path: "message/a.json",
        }),
        Item.from_json({
          dst: "m3",
          row: 3,
          file_type: "MESSAGEJSON",
          file_path: "message/a.json",
        }),
      ],
      {
        translated_path: temp_dir,
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    const result = JSON.parse(fs.readFileSync(path.join(temp_dir, "message", "a.json"), "utf-8"));
    const hero_entries = result.filter(
      (value: Record<string, unknown>) => value["name"] !== undefined,
    );
    expect(hero_entries.map((value: Record<string, unknown>) => value["name"])).toEqual([
      "勇者",
      "勇者",
      "勇者",
    ]);
    expect(result).toContainEqual({ message: "m3" });
  });

  it("禁用译名写回时还原 name_src 并按行号排序", async () => {
    const format = new MESSAGEJSONFormat({
      source_language: "JA",
      target_language: "ZH",
      write_translated_name_fields_to_file: false,
    });

    await format.write_to_path(
      [
        Item.from_json({
          src: "old1",
          dst: "new1",
          name_src: "原名",
          name_dst: "译名",
          row: 2,
          file_type: "MESSAGEJSON",
          file_path: "message/a.json",
        }),
        Item.from_json({
          src: "old0",
          dst: "new0",
          name_src: ["甲", "乙"],
          name_dst: ["A", "B"],
          row: 1,
          file_type: "MESSAGEJSON",
          file_path: "message/a.json",
        }),
      ],
      {
        translated_path: temp_dir,
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(JSON.parse(fs.readFileSync(path.join(temp_dir, "message", "a.json"), "utf-8"))).toEqual([
      { names: ["甲", "乙"], message: "new0" },
      { name: "原名", message: "new1" },
    ]);
  });
});

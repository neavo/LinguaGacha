import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";

import { Item } from "../../../domain/item";
import { KVJSONFormat } from "./kvjson-format";

describe("KVJSONFormat", () => {
  it("按 key/value 关系设置 KVJSON 状态", async () => {
    const format = new KVJSONFormat();

    const items = await format.read_from_stream(
      new TextEncoder().encode(JSON.stringify({ "": "", 已翻: "已处理", 待翻: "待翻", 忽略: 1 })),
      "a.json",
    );

    expect(items.map((item) => [item.src, item.dst, item.status])).toEqual([
      ["", "", "RULE_SKIPPED"],
      ["已翻", "已处理", "PROCESSED"],
      ["待翻", "", "NONE"],
    ]);
  });

  it("非对象 JSON 不按 KVJSON 解析", async () => {
    const format = new KVJSONFormat();

    await expect(
      format.read_from_stream(
        new TextEncoder().encode(JSON.stringify([{ message: "台词" }])),
        "message.json",
      ),
    ).resolves.toEqual([]);
  });

  it("通过共享文本解码入口解析传统编码 JSON", async () => {
    const format = new KVJSONFormat();

    const items = await format.read_from_stream(
      iconv.encode(JSON.stringify({ café: "élève" }), "windows-1252"),
      "legacy.json",
    );

    expect(items.map((item) => [item.src, item.dst])).toEqual([["café", "élève"]]);
  });

  it("写回 key 到有效译文的 JSON 对象", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-kvjson-format-"));
    const format = new KVJSONFormat();
    await format.write_to_path(
      [
        Item.from_json({
          src: "k1",
          dst: "v1",
          row: 0,
          file_type: "KVJSON",
          file_path: "json/data.json",
        }),
        Item.from_json({
          src: "k2",
          dst: "v2",
          row: 1,
          file_type: "KVJSON",
          file_path: "json/data.json",
        }),
        Item.from_json({
          src: "k3",
          dst: "",
          row: 2,
          file_type: "KVJSON",
          file_path: "json/data.json",
        }),
      ],
      {
        translated_path: temp_dir.path,
        bilingual_path: path.join(temp_dir.path, "bilingual"),
      },
    );

    expect(
      JSON.parse(fs.readFileSync(path.join(temp_dir.path, "json", "data.json"), "utf-8")),
    ).toEqual({
      k1: "v1",
      k2: "v2",
      k3: "k3",
    });
  });
});

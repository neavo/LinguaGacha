import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Item } from "../../../base/item";
import { KVJSONFormat } from "./kvjson-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-kvjson-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("KVJSONFormat", () => {
  it("按 key/value 关系设置 KVJSON 状态", async () => {
    const format = new KVJSONFormat();

    const items = await format.read_from_stream(
      new TextEncoder().encode(JSON.stringify({ "": "", 已翻: "已处理", 待翻: "待翻", 忽略: 1 })),
      "a.json",
    );

    expect(items.map((item) => [item.src, item.dst, item.status])).toEqual([
      ["", "", "EXCLUDED"],
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

  it("写回 key 到有效译文的 JSON 对象", async () => {
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
        translated_path: temp_dir,
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(JSON.parse(fs.readFileSync(path.join(temp_dir, "json", "data.json"), "utf-8"))).toEqual({
      k1: "v1",
      k2: "v2",
      k3: "k3",
    });
  });
});

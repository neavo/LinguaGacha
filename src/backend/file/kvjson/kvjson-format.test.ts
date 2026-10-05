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
      ["待翻", "待翻", "NONE"],
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
});

it("带回退 KV 从原对象取基线，完成空正文不回退，并保留非条目字段", async () => {
  using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-kv-"));
  const original = Buffer.from(
    JSON.stringify({ a: "A", b: "", c: "旧译文", d: "旧译文", extra: 42 }),
  );
  const items = [
    Item.from_json({
      src: "a",
      dst: "B",
      status: "ERROR",
      file_type: "KVJSON",
      file_path: "x.json",
    }),
    Item.from_json({
      src: "b",
      dst: "B",
      status: "NONE",
      file_type: "KVJSON",
      file_path: "x.json",
    }),
    Item.from_json({
      src: "c",
      dst: "",
      status: "PROCESSED",
      file_type: "KVJSON",
      file_path: "x.json",
    }),
    Item.from_json({
      src: "d",
      dst: "新译文",
      status: "PROCESSED",
      file_type: "KVJSON",
      file_path: "x.json",
    }),
  ];
  await new KVJSONFormat().write_to_path(
    items,
    { translated_path: dir.path, bilingual_path: dir.path },
    () => original,
  );
  expect(JSON.parse(fs.readFileSync(path.join(dir.path, "x.json"), "utf8"))).toEqual({
    a: "A",
    b: "b",
    c: "",
    d: "新译文",
    extra: 42,
  });
});

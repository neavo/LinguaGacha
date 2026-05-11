import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalize_item } from "../../../base/item";
import { KVJSONFormat } from "./kvjson-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-kvjson-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("KVJSONFormat", () => {
  it("把 JSON 对象的 key 作为原文，差异 value 作为已有译文", async () => {
    const format = new KVJSONFormat();

    const items = await format.read_from_stream(
      new TextEncoder().encode(JSON.stringify({ 甲: "甲", 乙: "乙译", 空: "" })),
      "kv.json",
    );

    expect(items.map((item) => [item.src, item.dst, item.status])).toEqual([
      ["甲", "", "NONE"],
      ["乙", "乙译", "PROCESSED"],
      ["空", "", "NONE"],
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
        normalize_item({
          src: "原文",
          dst: "译文",
          row: 0,
          file_type: "KVJSON",
          file_path: "kv.json",
        }),
      ],
      {
        translated_path: temp_dir,
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(JSON.parse(fs.readFileSync(path.join(temp_dir, "kv.json"), "utf-8"))).toEqual({
      原文: "译文",
    });
  });
});

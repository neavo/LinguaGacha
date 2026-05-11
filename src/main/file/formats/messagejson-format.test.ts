import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalize_item } from "../../../base/item";
import { MESSAGEJSONFormat } from "./messagejson-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-messagejson-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("MESSAGEJSONFormat", () => {
  it("只解析含 message 字符串的数组对象，并保留 name 字段", async () => {
    const format = new MESSAGEJSONFormat({ source_language: "JA", target_language: "ZH" });

    const items = await format.read_from_stream(
      new TextEncoder().encode(
        JSON.stringify([{ name: "角色", message: "台词" }, { name: "无效" }]),
      ),
      "message.json",
    );

    expect(items).toEqual([
      expect.objectContaining({
        src: "台词",
        name_src: "角色",
        name_dst: "角色",
        file_type: "MESSAGEJSON",
        text_type: "KAG",
      }),
    ]);
  });

  it("写回时按配置使用译名字段", async () => {
    const format = new MESSAGEJSONFormat({
      source_language: "JA",
      target_language: "ZH",
      write_translated_name_fields_to_file: true,
    });
    await format.write_to_path(
      [
        normalize_item({
          src: "台词",
          dst: "译文",
          name_src: "名前",
          name_dst: "译名",
          row: 0,
          file_type: "MESSAGEJSON",
          file_path: "message.json",
        }),
      ],
      {
        translated_path: temp_dir,
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(JSON.parse(fs.readFileSync(path.join(temp_dir, "message.json"), "utf-8"))).toEqual([
      { name: "译名", message: "译文" },
    ]);
  });
});

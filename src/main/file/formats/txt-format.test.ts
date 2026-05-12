import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Item } from "../../../base/item";
import { TXTFormat } from "./txt-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-txt-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("TXTFormat", () => {
  it("按行解析 TXT 并保留行号", async () => {
    const format = new TXTFormat({ source_language: "JA", target_language: "ZH" });

    await expect(
      format.read_from_stream(new TextEncoder().encode("甲\n乙"), "demo.txt"),
    ).resolves.toEqual([
      expect.objectContaining({ src: "甲", row: 0, file_type: "TXT", file_path: "demo.txt" }),
      expect.objectContaining({ src: "乙", row: 1, file_type: "TXT", file_path: "demo.txt" }),
    ]);
  });

  it("写出译文和双语目录，并按配置折叠重复双语行", async () => {
    const format = new TXTFormat({
      source_language: "JA",
      target_language: "ZH",
      deduplication_in_bilingual: true,
    });
    await format.write_to_path(
      [
        Item.from_json({
          src: "原文",
          dst: "译文",
          row: 0,
          file_type: "TXT",
          file_path: "script.txt",
        }),
        Item.from_json({
          src: "同文",
          dst: "",
          row: 1,
          file_type: "TXT",
          file_path: "script.txt",
        }),
      ],
      {
        translated_path: path.join(temp_dir, "demo_译文"),
        bilingual_path: path.join(temp_dir, "demo_译文_双语对照"),
      },
    );

    expect(fs.readFileSync(path.join(temp_dir, "demo_译文", "script.zh.txt"), "utf-8")).toBe(
      "译文\n同文",
    );
    expect(
      fs.readFileSync(path.join(temp_dir, "demo_译文_双语对照", "script.ja.zh.txt"), "utf-8"),
    ).toBe("原文\n译文\n同文");
  });
});

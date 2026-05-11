import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalize_item } from "../../../base/item";
import { ASSFormat } from "./ass-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-ass-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ASSFormat", () => {
  it("从 Dialogue 尾部文本字段解析字幕正文", async () => {
    const format = new ASSFormat({ source_language: "JA", target_language: "ZH" });
    const content =
      "[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,こんにちは\\N世界";

    const items = await format.read_from_stream(new TextEncoder().encode(content), "demo.ass");

    expect(items.at(-1)).toEqual(
      expect.objectContaining({
        src: "こんにちは\n世界",
        extra_field: "Dialogue: 0,0:00:01.00,0:00:02.00,Default,{{CONTENT}}",
        file_type: "ASS",
      }),
    );
  });

  it("写回 ASS 模板并用 \\N 生成双语字幕", async () => {
    const format = new ASSFormat({
      source_language: "JA",
      target_language: "ZH",
      deduplication_in_bilingual: false,
    });
    await format.write_to_path(
      [
        normalize_item({
          src: "原文",
          dst: "译文",
          extra_field: "Dialogue: 0,0:00:01.00,0:00:02.00,Default,{{CONTENT}}",
          row: 0,
          file_type: "ASS",
          file_path: "demo.ass",
        }),
      ],
      {
        translated_path: path.join(temp_dir, "translated"),
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(fs.readFileSync(path.join(temp_dir, "translated", "demo.zh.ass"), "utf-8")).toBe(
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,译文",
    );
    expect(fs.readFileSync(path.join(temp_dir, "bilingual", "demo.ja.zh.ass"), "utf-8")).toBe(
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,原文\\N译文",
    );
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Item } from "../../../base/item";
import { ASSFormat } from "./ass-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-ass-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ASSFormat", () => {
  it("从 Dialogue 文本列解析字幕正文并保留写回模板", async () => {
    const format = new ASSFormat({ source_language: "JA", target_language: "ZH" });
    const content =
      "[Script Info]\n" +
      "Title: Test\n" +
      "[Events]\n" +
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" +
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,第一行\\N第二行\n";

    const items = await format.read_from_stream(new TextEncoder().encode(content), "sub.ass");

    expect(items.at(-1)).toEqual(
      expect.objectContaining({
        src: "第一行\n第二行",
        dst: "",
        extra_field: "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{{CONTENT}}",
        file_type: "ASS",
      }),
    );
  });

  it("缺少 Format 行时仍按历史切片逻辑解析 Dialogue", async () => {
    const format = new ASSFormat({ source_language: "JA", target_language: "ZH" });
    const content = "[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Text\n";

    const items = await format.read_from_stream(new TextEncoder().encode(content), "sub.ass");

    expect(items.at(-1)?.src).toBe("Text");
    expect(String(items.at(-1)?.extra_field)).toContain("{{CONTENT}}");
  });

  it("写回 ASS 译文和未去重双语字幕", async () => {
    const format = new ASSFormat({
      source_language: "JA",
      target_language: "ZH",
      deduplication_in_bilingual: false,
    });
    await format.write_to_path(
      [
        Item.from_json({
          src: "原文1",
          dst: "译文1",
          extra_field: "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{{CONTENT}}",
          row: 0,
          file_type: "ASS",
          file_path: "anime/sub.ass",
        }),
        Item.from_json({
          src: "原文2",
          dst: "译文2",
          extra_field: "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{{CONTENT}}",
          row: 1,
          file_type: "ASS",
          file_path: "anime/sub.ass",
        }),
      ],
      {
        translated_path: path.join(temp_dir, "translated"),
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(fs.readFileSync(path.join(temp_dir, "translated", "anime", "sub.zh.ass"), "utf-8")).toBe(
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,译文1\n" +
        "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,译文2",
    );
    expect(
      fs.readFileSync(path.join(temp_dir, "bilingual", "anime", "sub.ja.zh.ass"), "utf-8"),
    ).toBe(
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,原文1\\N译文1\n" +
        "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,原文2\\N译文2",
    );
  });

  it("双语去重时原文译文一致只写一份内容", async () => {
    const format = new ASSFormat({
      source_language: "JA",
      target_language: "ZH",
      deduplication_in_bilingual: true,
    });
    await format.write_to_path(
      [
        Item.from_json({
          src: "同文",
          dst: "同文",
          extra_field: "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{{CONTENT}}",
          row: 0,
          file_type: "ASS",
          file_path: "anime/sub.ass",
        }),
      ],
      {
        translated_path: path.join(temp_dir, "translated"),
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    const content = fs.readFileSync(
      path.join(temp_dir, "bilingual", "anime", "sub.ja.zh.ass"),
      "utf-8",
    );
    expect(content).toBe("Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,同文");
    expect(content).not.toContain("{{CONTENT}}");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Item } from "../../../domain/item";
import { SRTFormat } from "./srt-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-srt-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("SRTFormat", () => {
  it("解析标准字幕块并跳过非数字序号块", async () => {
    const format = new SRTFormat({ source_language: "JA", target_language: "ZH" });
    const content =
      "1\n00:00:01,000 --> 00:00:02,000\n第一句\n\n" +
      "x\n00:00:03,000 --> 00:00:04,000\n应被跳过\n\n" +
      "2\n00:00:05,000 --> 00:00:06,000\n第二句\n第二行";

    const items = await format.read_from_stream(new TextEncoder().encode(content), "sub.srt");

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({
        row: 1,
        extra_field: "00:00:01,000 --> 00:00:02,000",
        src: "第一句",
      }),
    );
    expect(items[1]).toEqual(expect.objectContaining({ row: 2, src: "第二句\n第二行" }));
  });

  it("忽略开头和额外空行后保留字幕序号", async () => {
    const format = new SRTFormat({ source_language: "JA", target_language: "ZH" });
    const content =
      "\n\n" +
      "1\n00:00:01,000 --> 00:00:02,000\n第一句\n\n\n" +
      "2\n00:00:03,000 --> 00:00:04,000\n第二句\n\n";

    const items = await format.read_from_stream(new TextEncoder().encode(content), "sub.srt");

    expect(items.map((item) => item.row)).toEqual([1, 2]);
  });

  it("写出译文和双语字幕块", async () => {
    const format = new SRTFormat({
      source_language: "JA",
      target_language: "ZH",
      deduplication_in_bilingual: true,
    });
    await format.write_to_path(
      [
        Item.from_json({
          src: "同文",
          dst: "同文",
          extra_field: "00:00:01,000 --> 00:00:02,000",
          row: 1,
          file_type: "SRT",
          file_path: "video/a.srt",
        }),
        Item.from_json({
          src: "原文",
          dst: "译文",
          extra_field: "00:00:03,000 --> 00:00:04,000",
          row: 2,
          file_type: "SRT",
          file_path: "video/a.srt",
        }),
      ],
      {
        translated_path: path.join(temp_dir, "translated"),
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(fs.readFileSync(path.join(temp_dir, "translated", "video", "a.srt"), "utf-8")).toBe(
      "1\n00:00:01,000 --> 00:00:02,000\n同文\n\n" + "2\n00:00:03,000 --> 00:00:04,000\n译文\n\n",
    );
    expect(fs.readFileSync(path.join(temp_dir, "bilingual", "video", "a.srt"), "utf-8")).toBe(
      "1\n00:00:01,000 --> 00:00:02,000\n同文\n\n" +
        "2\n00:00:03,000 --> 00:00:04,000\n原文\n译文\n\n",
    );
  });

  it("没有 SRT 条目时不创建输出文件", async () => {
    const format = new SRTFormat({ source_language: "JA", target_language: "ZH" });

    await format.write_to_path([], {
      translated_path: path.join(temp_dir, "translated"),
      bilingual_path: path.join(temp_dir, "bilingual"),
    });

    expect(fs.existsSync(path.join(temp_dir, "translated"))).toBe(false);
    expect(fs.existsSync(path.join(temp_dir, "bilingual"))).toBe(false);
  });

  it("禁用双语去重时即使原文译文一致也写出两行", async () => {
    const format = new SRTFormat({
      source_language: "JA",
      target_language: "ZH",
      deduplication_in_bilingual: false,
    });

    await format.write_to_path(
      [
        Item.from_json({
          src: "同文",
          dst: "同文",
          extra_field: "00:00:01,000 --> 00:00:02,000",
          row: 1,
          file_type: "SRT",
          file_path: "demo.srt",
        }),
      ],
      {
        translated_path: path.join(temp_dir, "translated"),
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(fs.readFileSync(path.join(temp_dir, "bilingual", "demo.srt"), "utf-8")).toBe(
      "1\n00:00:01,000 --> 00:00:02,000\n同文\n同文\n\n",
    );
  });
});

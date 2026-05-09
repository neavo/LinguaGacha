import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalize_file_item } from "../file-item";
import { SRTFormat } from "./srt-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-srt-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("SRTFormat", () => {
  it("按字幕块解析序号、时间轴和多行正文", async () => {
    const format = new SRTFormat({ source_language: "JA", target_language: "ZH" });
    const content = "1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n世界\n";

    await expect(
      format.read_from_stream(new TextEncoder().encode(content), "demo.srt"),
    ).resolves.toEqual([
      expect.objectContaining({
        src: "こんにちは\n世界",
        extra_field: "00:00:01,000 --> 00:00:02,000",
        row: 1,
        file_type: "SRT",
      }),
    ]);
  });

  it("写出译文和双语字幕块", async () => {
    const format = new SRTFormat({
      source_language: "JA",
      target_language: "ZH",
      deduplication_in_bilingual: false,
    });
    await format.write_to_path(
      [
        normalize_file_item({
          src: "原文",
          dst: "译文",
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

    expect(fs.readFileSync(path.join(temp_dir, "translated", "demo.zh.srt"), "utf-8")).toBe(
      "1\n00:00:01,000 --> 00:00:02,000\n译文\n\n",
    );
    expect(fs.readFileSync(path.join(temp_dir, "bilingual", "demo.ja.zh.srt"), "utf-8")).toBe(
      "1\n00:00:01,000 --> 00:00:02,000\n原文\n译文\n\n",
    );
  });
});

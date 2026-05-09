import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileFormatService } from "./file-format-service";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-file-format-service-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

/**
 * 测试统一使用显式配置，避免依赖用户本机设置。
 */
function create_service(): FileFormatService {
  return new FileFormatService({
    source_language: "JA",
    target_language: "ZH",
    deduplication_in_bilingual: true,
    write_translated_name_fields_to_file: true,
  });
}

describe("FileFormatService", () => {
  it("按公开支持扩展名识别文件，并单独标记 EPUB 保留路径", () => {
    const service = create_service();

    expect(service.is_supported_file("script.txt")).toBe(true);
    expect(service.is_supported_file("script.epub")).toBe(true);
    expect(service.is_supported_file("archive.bin")).toBe(false);
    expect(service.is_epub_path("novel.EPUB")).toBe(true);
    expect(service.is_epub_path("script.txt")).toBe(false);
  });

  it("按扩展名分发解析器，并保持 JSON 的 KV 优先与 MESSAGE fallback", async () => {
    const service = create_service();

    const txt_items = await service.parse_asset("demo.txt", new TextEncoder().encode("甲"));
    const kv_items = await service.parse_asset(
      "kv.json",
      new TextEncoder().encode(JSON.stringify({ 甲: "译文" })),
    );
    const message_items = await service.parse_asset(
      "message.json",
      new TextEncoder().encode(JSON.stringify([{ name: "名", message: "台词" }])),
    );

    expect(txt_items.map((item) => item.file_type)).toEqual(["TXT"]);
    expect(kv_items.map((item) => item.file_type)).toEqual(["KVJSON"]);
    expect(message_items.map((item) => item.file_type)).toEqual(["MESSAGEJSON"]);
  });

  it("收集源文件时去重输入路径并为重复相对路径生成稳定文件名", () => {
    const service = create_service();
    const left_dir = path.join(temp_dir, "left");
    const right_dir = path.join(temp_dir, "right");
    fs.mkdirSync(left_dir, { recursive: true });
    fs.mkdirSync(right_dir, { recursive: true });
    fs.writeFileSync(path.join(left_dir, "script.txt"), "左", "utf-8");
    fs.writeFileSync(path.join(right_dir, "script.txt"), "右", "utf-8");
    fs.writeFileSync(path.join(right_dir, "ignored.bin"), "x", "utf-8");

    expect(service.normalize_source_paths([left_dir, left_dir, "", right_dir])).toEqual([
      left_dir,
      right_dir,
    ]);
    expect(
      service
        .collect_source_file_entries([left_dir, right_dir])
        .map((entry) => entry.rel_path.replace(/\\/gu, "/")),
    ).toEqual(["script.txt", "script_2.txt"]);
  });

  it("工作台预览替换文件时沿用旧相对目录", async () => {
    const service = create_service();
    const source_file = path.join(temp_dir, "new.txt");
    fs.writeFileSync(source_file, "新文本", "utf-8");

    await expect(service.parse_file_preview(source_file, "old/path/original.txt")).resolves.toEqual(
      expect.objectContaining({
        target_rel_path: path.join("old/path", "new.txt"),
        file_type: "TXT",
      }),
    );
  });
});

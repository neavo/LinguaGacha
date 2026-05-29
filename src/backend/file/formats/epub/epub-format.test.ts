import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { create_epub_fixture } from "../../../../test/epub-fixture";
import { Item } from "../../../../domain/item";
import { EPUBFormat } from "./epub-format";

let temp_dir = ""; // 每个用例独占 EPUB 输出目录，避免门面写回断言共享文件状态

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-epub-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

/**
 * 测试格式实例使用显式配置，避免依赖应用设置服务
 */
function create_format(): EPUBFormat {
  return new EPUBFormat({
    source_language: "JA",
    target_language: "ZH",
    deduplication_in_bilingual: true,
    write_translated_name_fields_to_file: true,
  });
}

describe("EPUBFormat", () => {
  it("替换源文件时保留旧 EPUB 相对目录", () => {
    const format = create_format();

    expect(format.build_replace_target_rel_path("old/path/original.epub", "book.epub")).toBe(
      path.join("old/path", "book.epub"),
    );
    expect(format.build_replace_target_rel_path("original.epub", "book.epub")).toBe("book.epub");
  });

  it("写回 EPUB 时按门面规则生成译文和双语文件", async () => {
    const format = create_format();
    const epub_asset = await create_epub_fixture("章节");
    const [parsed_item] = await format.read_from_stream(epub_asset, "book.epub");
    if (parsed_item === undefined) {
      throw new Error("EPUB fixture 未生成正文条目。");
    }
    const paths = {
      translated_path: path.join(temp_dir, "translated"),
      bilingual_path: path.join(temp_dir, "bilingual"),
    };

    await format.write_to_path(
      [
        Item.from_json({
          ...parsed_item.to_json(),
          dst: "译文",
          status: "PROCESSED",
        }),
      ],
      paths,
      (rel_path) => (rel_path === "book.epub" ? epub_asset : null),
    );

    expect(fs.existsSync(path.join(paths.translated_path, "book.epub"))).toBe(true);
    expect(fs.existsSync(path.join(paths.bilingual_path, "book.epub"))).toBe(true);
  });

  it("回归 EPUB issue：长文件名写回后译文版和双语版都是可读 EPUB", async () => {
    const format = create_format();
    const file_name =
      "Stalingradas tragedija prie Volgos -- Joachim Wieder -- Anna Archive sample.epub";
    const epub_asset = await create_epub_fixture("章节");
    const [parsed_item] = await format.read_from_stream(epub_asset, file_name);
    if (parsed_item === undefined) {
      throw new Error("EPUB fixture 未生成正文条目。");
    }
    const paths = {
      translated_path: path.join(temp_dir, "translated-long-name"),
      bilingual_path: path.join(temp_dir, "bilingual-long-name"),
    };

    await format.write_to_path(
      [
        Item.from_json({
          ...parsed_item.to_json(),
          dst: "译文",
          status: "PROCESSED",
        }),
      ],
      paths,
      (rel_path) => (rel_path === file_name ? epub_asset : null),
    );

    await expect(
      JSZip.loadAsync(fs.readFileSync(path.join(paths.translated_path, file_name))),
    ).resolves.toBeDefined();
    await expect(
      JSZip.loadAsync(fs.readFileSync(path.join(paths.bilingual_path, file_name))),
    ).resolves.toBeDefined();
  });
});

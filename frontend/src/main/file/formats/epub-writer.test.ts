import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { create_epub_fixture, read_epub_entry_text } from "../../../test/epub-fixture";
import { normalize_file_item, type FileFormatItem } from "../file-item";
import { EpubAst } from "./epub-ast";
import { EpubWriter } from "./epub-writer";

// 每个用例独占 EPUB 输出目录，避免 zip 写回结果互相污染。
let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

/**
 * 写回器配置固定为日译中，便于断言导出后的可见正文。
 */
function create_writer(): EpubWriter {
  return new EpubWriter({
    source_language: "JA",
    target_language: "ZH",
    deduplication_in_bilingual: true,
    write_translated_name_fields_to_file: true,
  });
}

/**
 * writer 测试只借 AST 生成定位 metadata，断言归属仍聚焦写回产物。
 */
async function create_translated_epub_item(
  epub_asset: Buffer,
  dst: string,
): Promise<FileFormatItem> {
  const [item] = await new EpubAst().read_from_stream(epub_asset, "book.epub");
  if (item === undefined) {
    throw new Error("EPUB fixture 未生成正文条目。");
  }
  return normalize_file_item({
    ...item,
    dst,
    status: "PROCESSED",
  });
}

describe("EpubWriter", () => {
  it("按 AST metadata 写出译文并在双语版保留原文块", async () => {
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const item = await create_translated_epub_item(epub_asset, "译文");
    const translated_path = path.join(temp_dir, "translated", "book.zh.epub");
    const bilingual_path = path.join(temp_dir, "bilingual", "book.ja.zh.epub");

    await writer.build_epub(epub_asset, [item], translated_path, false);
    await writer.build_epub(epub_asset, [item], bilingual_path, true);

    await expect(read_epub_entry_text(fs.readFileSync(translated_path))).resolves.toContain("译文");
    await expect(read_epub_entry_text(fs.readFileSync(bilingual_path))).resolves.toContain("章节");
    await expect(read_epub_entry_text(fs.readFileSync(bilingual_path))).resolves.toContain("译文");
  });

  it("AST 写回保留 XML 合法补充平面字符", async () => {
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const item = await create_translated_epub_item(epub_asset, "译文😀𠀀");
    const out_path = path.join(temp_dir, "supplementary", "book.zh.epub");

    await writer.build_epub(epub_asset, [item], out_path, false);

    await expect(read_epub_entry_text(fs.readFileSync(out_path))).resolves.toContain("译文😀𠀀");
  });

  it("缺少 AST metadata 时回退 legacy 顺序写回", async () => {
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const out_path = path.join(temp_dir, "legacy", "book.zh.epub");
    const legacy_item = normalize_file_item({
      src: "章节",
      dst: "译文",
      row: 0,
      file_type: "EPUB",
      file_path: "book.epub",
      tag: "OPS/chapter.xhtml",
      status: "PROCESSED",
    });

    expect(writer.has_epub_ast_metadata(legacy_item)).toBe(false);

    await writer.build_epub(epub_asset, [legacy_item], out_path, false);

    await expect(read_epub_entry_text(fs.readFileSync(out_path))).resolves.toContain("译文");
  });

  it("legacy 写回按字面量保留 replacement 特殊美元序列", async () => {
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const out_path = path.join(temp_dir, "legacy-special-dollar", "book.zh.epub");
    const legacy_item = normalize_file_item({
      src: "章节",
      dst: "译文$& $1 $$",
      row: 0,
      file_type: "EPUB",
      file_path: "book.epub",
      tag: "OPS/chapter.xhtml",
      status: "PROCESSED",
    });

    await writer.build_epub(epub_asset, [legacy_item], out_path, false);

    const written_text = await read_epub_entry_text(fs.readFileSync(out_path));

    expect(written_text).toContain("译文$&amp; $1 $$");
    expect(written_text).not.toContain("译文章节");
  });
});

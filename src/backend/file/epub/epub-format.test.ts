import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { create_epub_fixture, read_epub_entry_text } from "../../../test/epub-fixture";
import { Item } from "../../../domain/item";
import { EPUBFormat } from "./epub-format";

/**
 * 测试格式实例使用显式配置，避免依赖应用设置服务
 */
function create_format(): EPUBFormat {
  return new EPUBFormat({
    target_language: "ZH",
    deduplication_in_bilingual: true,
    write_translated_name_fields_to_file: true,
  });
}

describe("EPUBFormat", () => {
  it("原始资产缺失时拒绝导出", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-format-"));
    await expect(
      create_format().write_to_path(
        [Item.from_json({ file_type: "EPUB", file_path: "book.epub", src: "原文", dst: "译文" })],
        { translated_path: temp_dir.path, bilingual_path: path.join(temp_dir.path, "bilingual") },
        () => null,
      ),
    ).rejects.toMatchObject({ code: "file.not_found", public_details: { file: "book.epub" } });
    expect(fs.readdirSync(temp_dir.path)).toEqual([]);
  });

  it("长文件名写回保留单语译文与双语原文", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-format-"));
    const format = create_format();
    const file_name =
      "Stalingradas tragedija prie Volgos -- Joachim Wieder -- Anna Archive sample.epub";
    const epub_asset = await create_epub_fixture("章节");
    const [parsed_item] = await format.read_from_stream(epub_asset, file_name);
    if (parsed_item === undefined) {
      throw new Error("EPUB fixture 未生成正文条目。");
    }
    const paths = {
      translated_path: path.join(temp_dir.path, "translated-long-name"),
      bilingual_path: path.join(temp_dir.path, "bilingual-long-name"),
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

    const translated = await read_epub_entry_text(
      fs.readFileSync(path.join(paths.translated_path, file_name)),
    );
    const bilingual = await read_epub_entry_text(
      fs.readFileSync(path.join(paths.bilingual_path, file_name)),
    );
    expect(translated).toContain("译文");
    expect(translated).not.toContain("章节");
    expect(bilingual).toContain("译文");
    expect(bilingual).toContain("章节");
  });
});

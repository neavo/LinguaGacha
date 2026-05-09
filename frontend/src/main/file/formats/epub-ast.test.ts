import { describe, expect, it } from "vitest";

import { create_epub_fixture } from "../../../test/epub-fixture";
import { normalize_file_item } from "../file-item";
import { EpubAst, read_epub_extra } from "./epub-ast";

describe("EpubAst", () => {
  it("从 EPUB spine 提取正文条目并写入 AST metadata", async () => {
    const ast = new EpubAst();
    const epub_asset = await create_epub_fixture("章节");

    const items = await ast.read_from_stream(epub_asset, "book.epub");
    const [item] = items;
    if (item === undefined) {
      throw new Error("EPUB fixture 未生成正文条目。");
    }
    const epub = read_epub_extra(item);

    expect(items).toHaveLength(1);
    expect(item).toEqual(
      expect.objectContaining({
        src: "章节",
        dst: "",
        row: 0,
        file_type: "EPUB",
        file_path: "book.epub",
        tag: "OPS/chapter.xhtml",
        status: "NONE",
      }),
    );
    expect(epub).toEqual(
      expect.objectContaining({
        mode: "slot_per_line",
        doc_path: "OPS/chapter.xhtml",
        block_path: "/html[1]/body[1]/p[1]",
        src_digest: expect.any(String),
        is_nav: false,
      }),
    );
    expect(epub?.["parts"]).toEqual([{ slot: "text", path: "/html[1]/body[1]/p[1]" }]);
  });

  it("缺少 EPUB metadata 时返回空 extra", () => {
    expect(
      read_epub_extra(
        normalize_file_item({
          src: "原文",
          file_type: "TXT",
          file_path: "script.txt",
          extra_field: null,
        }),
      ),
    ).toBeNull();
  });

  it("归一 EPUB 内部路径为 zip 可比较格式", () => {
    const ast = new EpubAst();

    expect(ast.normalize_epub_path("OPS\\chapter.xhtml")).toBe("OPS/chapter.xhtml");
  });
});

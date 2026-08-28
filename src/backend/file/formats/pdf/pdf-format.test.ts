import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const read_pdf_markdown = vi.hoisted(() => vi.fn());
vi.mock("./pdf-markdown-reader", () => ({ read_pdf_markdown }));

import { PDFFormat } from "./pdf-format";

describe("PDFFormat", () => {
  it("把 PDF Markdown 转为 PDF/MD 块并保留 Markdown V2 metadata", async () => {
    read_pdf_markdown.mockReturnValueOnce("# 标题\n\n正文\n\n```ts\ncode\n```\n");

    const items = await new PDFFormat().read_from_stream(new Uint8Array([1]), "docs/demo.pdf");

    expect(items.map((item) => item.to_json())).toEqual([
      expect.objectContaining({
        src: "# 标题",
        row: 0,
        file_type: "PDF",
        file_path: "docs/demo.pdf",
        text_type: "MD",
        status: "NONE",
        extra_field: { markdown: { before: "", after: "" } },
      }),
      expect.objectContaining({
        src: "正文",
        row: 2,
        file_type: "PDF",
        text_type: "MD",
        extra_field: { markdown: { before: "\n\n", after: "" } },
      }),
      expect.objectContaining({
        src: "```ts\ncode\n```",
        row: 4,
        file_type: "PDF",
        text_type: "MD",
        status: "EXCLUDED",
      }),
    ]);
  });

  it("按 Markdown V2 语义恢复资源并只写 translated PDF", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-pdf-format-"));
    const format = new PDFFormat();
    const source = "# 标题\n\n![封面](image.png)\n";
    read_pdf_markdown.mockReturnValue(source);
    const items = await format.read_from_stream(new Uint8Array([1]), "docs/demo.pdf");
    items[0]!.dst = "# 译题";
    items[1]!.dst = "![译图](lg-resource:image/0)";
    const render_pdf = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));

    await format.write_to_path(items.reverse(), {
      paths: {
        translated_path: path.join(temp_dir.path, "translated"),
        bilingual_path: path.join(temp_dir.path, "bilingual"),
      },
      asset_reader: () => Buffer.from([1]),
      render_pdf,
    });

    expect(render_pdf).toHaveBeenCalledWith("# 译题\n\n![译图](image.png)\n");
    expect(fs.readFileSync(path.join(temp_dir.path, "translated", "docs", "demo.pdf"))).toEqual(
      Buffer.from([37, 80, 68, 70]),
    );
    expect(fs.existsSync(path.join(temp_dir.path, "bilingual", "docs", "demo.pdf"))).toBe(false);
  });

  it("asset 缺失或二次转换失败时仍渲染当前译文", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-pdf-format-"));
    read_pdf_markdown.mockReturnValueOnce("正文");
    const format = new PDFFormat();
    const items = await format.read_from_stream(new Uint8Array([1]), "demo.pdf");
    items[0]!.dst = "译文";
    const render_pdf = vi.fn(async () => new Uint8Array([1]));

    await format.write_to_path(items, {
      paths: { translated_path: temp_dir.path, bilingual_path: path.join(temp_dir.path, "bi") },
      asset_reader: () => null,
      render_pdf,
    });

    expect(render_pdf).toHaveBeenCalledWith("译文");
  });
});

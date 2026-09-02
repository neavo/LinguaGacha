import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NativeFs } from "../../../native/native-fs";
import { write_agent_workspace_sources } from "./sources";

describe("Agent 工作区源文件投影", () => {
  let temp_dir = "";

  beforeEach(() => {
    temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-sources-"));
  });

  afterEach(() => {
    fs.rmSync(temp_dir, { recursive: true, force: true });
  });

  it("文本转为 UTF-8，EPUB 与 XLSX 保留包内文本结构并排除二进制成员", async () => {
    const epub = new JSZip();
    epub.file("mimetype", "application/epub+zip");
    epub.file("OPS/chapter.xhtml", "<p>章节正文</p>");
    epub.file("OPS/image.png", Buffer.from([0, 1, 2]));
    const xlsx = new JSZip();
    xlsx.file("[Content_Types].xml", "<Types />");
    xlsx.file("xl/worksheets/sheet1.xml", "<worksheet><f>A1+B1</f></worksheet>");
    xlsx.file("xl/media/image1.png", Buffer.from([0, 1, 2]));
    const assets = new Map<string, Buffer>([
      ["script.trans", Buffer.from('\uFEFF{"gameTitle":"标题"}', "utf16le")],
      ["book.epub", await epub.generateAsync({ type: "nodebuffer" })],
      ["table.xlsx", await xlsx.generateAsync({ type: "nodebuffer" })],
    ]);

    const files = await write_agent_workspace_sources({
      nativeFs: new NativeFs(),
      sourceRoot: path.join(temp_dir, "sources"),
      files: [
        { file_path: "script.trans", file_type: "TRANS" },
        { file_path: "book.epub", file_type: "EPUB" },
        { file_path: "table.xlsx", file_type: "XLSX" },
      ],
      readAsset: (file_path) => assets.get(file_path) ?? null,
    });

    expect(files).toEqual([
      {
        file_path: "script.trans",
        file_type: "TRANS",
        source_text_path: "sources/script.trans",
      },
      { file_path: "book.epub", file_type: "EPUB", source_text_root: "sources/book.epub" },
      { file_path: "table.xlsx", file_type: "XLSX", source_text_root: "sources/table.xlsx" },
    ]);
    expect(fs.readFileSync(path.join(temp_dir, "sources", "script.trans"), "utf-8")).toBe(
      '{"gameTitle":"标题"}',
    );
    expect(
      fs.readFileSync(path.join(temp_dir, "sources", "book.epub", "OPS", "chapter.xhtml"), "utf-8"),
    ).toBe("<p>章节正文</p>");
    expect(
      fs.readFileSync(
        path.join(temp_dir, "sources", "table.xlsx", "xl", "worksheets", "sheet1.xml"),
        "utf-8",
      ),
    ).toBe("<worksheet><f>A1+B1</f></worksheet>");
    expect(fs.existsSync(path.join(temp_dir, "sources", "book.epub", "OPS", "image.png"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(temp_dir, "sources", "table.xlsx", "xl", "media", "image1.png")),
    ).toBe(false);
  });

  it("拒绝源文件相对路径逃逸 sources 根目录", async () => {
    await expect(
      write_agent_workspace_sources({
        nativeFs: new NativeFs(),
        sourceRoot: path.join(temp_dir, "sources"),
        files: [{ file_path: "../outside.txt", file_type: "TXT" }],
        readAsset: () => Buffer.from("outside", "utf-8"),
      }),
    ).rejects.toThrow("Invalid project source path");
    expect(fs.existsSync(path.join(temp_dir, "outside.txt"))).toBe(false);
  });
});

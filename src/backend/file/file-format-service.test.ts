import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const read_pdf_markdown = vi.hoisted(() => vi.fn(() => "# PDF 标题\n\n正文"));
vi.mock("./formats/pdf/pdf-markdown-reader", () => ({ read_pdf_markdown }));

import { FileFormatService } from "../file/file-format-service";
import { PROJECT_SOURCE_FORMATS } from "../../shared/project-source-formats";

/**
 * 测试统一使用显式配置，避免依赖用户本机设置
 */
function create_service(): FileFormatService {
  return new FileFormatService({
    target_language: "ZH",
    deduplication_in_bilingual: true,
    write_translated_name_fields_to_file: true,
  });
}

describe("FileFormatService", () => {
  it("按公开支持扩展名识别文件", () => {
    const service = create_service();

    expect(service.is_supported_file("script.txt")).toBe(true);
    expect(service.is_supported_file("script.epub")).toBe(true);
    expect(service.is_supported_file("report.pdf")).toBe(true);
    expect(service.is_supported_file("archive.bin")).toBe(false);
  });

  it("把 PDF 分发为 PDF/MD Markdown 块", async () => {
    const items = await create_service().parse_asset(
      "report.pdf",
      new Uint8Array([37, 80, 68, 70]),
    );

    expect(items).toEqual([
      expect.objectContaining({ file_type: "PDF", text_type: "MD", src: "# PDF 标题" }),
      expect.objectContaining({ file_type: "PDF", text_type: "MD", src: "正文" }),
    ]);
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

  it.each([
    ["a.md", "正文", "MD_V2"],
    [
      "a.ass",
      "[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,字幕",
      "ASS",
    ],
    ["a.srt", "1\n00:00:01,000 --> 00:00:02,000\n字幕\n", "SRT"],
  ] as const)("按简单扩展名解析 %s", async (rel_path, content, expected_type) => {
    const service = create_service();

    const items = await service.parse_asset(rel_path, new TextEncoder().encode(content));

    expect(items.at(-1)?.file_type).toBe(expected_type);
  });

  it("未知扩展名解析为空列表", async () => {
    const service = create_service();

    await expect(service.parse_asset("a.bin", new TextEncoder().encode("bytes"))).resolves.toEqual(
      [],
    );
  });

  it("收集目录源文件时保留入口目录名并去重输入路径", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-file-format-service-"),
    );
    const service = create_service();
    const left_dir = path.join(temp_dir.path, "left");
    const right_dir = path.join(temp_dir.path, "right");
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
    ).toEqual(["left/script.txt", "right/script.txt"]);
  });

  it("源文件摘要按去重后的互斥扩展名统计", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-file-format-service-"),
    );
    const service = create_service();
    const source_a = path.join(temp_dir.path, "source-a");
    const source_b = path.join(temp_dir.path, "source-b");
    const first_txt = path.join(source_a, "b.TXT");
    const ignored = path.join(source_a, "ignore.bin");
    fs.mkdirSync(path.join(source_a, "nested"), { recursive: true });
    fs.mkdirSync(source_b, { recursive: true });
    fs.writeFileSync(first_txt, "text", "utf-8");
    fs.writeFileSync(path.join(source_a, "nested", "a.md"), "markdown", "utf-8");
    fs.writeFileSync(ignored, "ignored", "utf-8");
    fs.writeFileSync(path.join(source_b, "c.json"), "{}", "utf-8");
    const expected_format_hit_counts = Object.fromEntries(
      PROJECT_SOURCE_FORMATS.map((format) => [format.id, 0]),
    );
    Object.assign(expected_format_hit_counts, { txt: 1, md: 1, json: 1 });

    expect(
      service.summarize_source_files(["", source_a, first_txt, ignored, source_b, source_a]),
    ).toEqual({
      source_file_count: 3,
      format_hit_counts: expected_format_hit_counts,
    });
  });

  it("收集单文件路径时使用文件名作为工程相对路径", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-file-format-service-"),
    );
    const service = create_service();
    const source_file = path.join(temp_dir.path, "nested", "a.MD");
    fs.mkdirSync(path.dirname(source_file), { recursive: true });
    fs.writeFileSync(source_file, "dummy", "utf-8");

    expect(service.collect_source_file_entries([source_file])).toEqual([
      { source_path: source_file, rel_path: "a.MD" },
    ]);
  });

  it("RenPy 导出通过 FileFormatService 注入姓名字段配置", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-file-format-service-"),
    );
    const service = new FileFormatService({
      target_language: "ZH",
      deduplication_in_bilingual: true,
      write_translated_name_fields_to_file: false,
    });
    const text = ["translate schinese start:", "", '    # "Alice" "Hello"', '    "艾丽丝" ""'].join(
      "\n",
    );
    const [item] = await service.parse_asset("script.rpy", new TextEncoder().encode(text));
    if (item === undefined) {
      throw new Error("测试样本应生成 RenPy 条目。");
    }
    item.dst = "你好";
    item.name_dst = "爱丽丝";

    await service.write_items([item], {
      paths: {
        translated_path: temp_dir.path,
        bilingual_path: path.join(temp_dir.path, "bilingual"),
      },
      asset_reader: () => Buffer.from(text),
      render_pdf: async () => new Uint8Array(),
    });

    expect(fs.readFileSync(path.join(temp_dir.path, "script.rpy"), "utf-8")).toContain(
      '"Alice" "你好"',
    );
  });
});

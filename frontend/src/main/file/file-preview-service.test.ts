import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ConfigService } from "../service/config-service";
import type { CoreBridgeClient } from "../core/core-bridge-client";
import { FilePreviewService } from "./file-preview-service";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-file-preview-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

function create_config_service(): ConfigService {
  return {
    load_config: () => ({
      source_language: "JA",
      target_language: "ZH",
      app_language: "ZH",
      deduplication_in_bilingual: true,
      write_translated_name_fields_to_file: true,
    }),
  } as unknown as ConfigService;
}

describe("FilePreviewService", () => {
  it("工作台预解析只返回成功解析的文件", async () => {
    const source_file = path.join(temp_dir, "script.txt");
    fs.writeFileSync(source_file, "原文", "utf-8");
    const service = new FilePreviewService(create_config_service(), {} as CoreBridgeClient);

    await expect(
      service.parse_workbench_file({
        source_paths: [source_file, path.join(temp_dir, "missing.bin")],
      }),
    ).resolves.toEqual({
      files: [
        expect.objectContaining({
          source_path: source_file,
          file_type: "TXT",
          target_rel_path: "script.txt",
        }),
      ],
    });
  });

  it("工作台预解析 EPUB 时走 Python EPUB 桥而不是静默丢弃", async () => {
    const epub_file = path.join(temp_dir, "book.epub");
    fs.writeFileSync(epub_file, "epub", "utf-8");
    const core_bridge = {
      parse_source_epub_files: async (source_paths: string[], current_rel_path?: string) =>
        source_paths.map((source_path) => ({
          source_path,
          target_rel_path: current_rel_path === undefined ? "book.epub" : "old/book.epub",
          file_type: "EPUB",
          parsed_items: [{ src: "章节", file_type: "EPUB", file_path: "old/book.epub" }],
        })),
    } as unknown as CoreBridgeClient;
    const service = new FilePreviewService(create_config_service(), core_bridge);

    await expect(
      service.parse_workbench_file({
        source_paths: [epub_file],
        current_rel_path: "old/original.epub",
      }),
    ).resolves.toEqual({
      files: [
        {
          source_path: epub_file,
          target_rel_path: "old/book.epub",
          file_type: "EPUB",
          parsed_items: [{ src: "章节", file_type: "EPUB", file_path: "old/book.epub" }],
        },
      ],
    });
  });

  it("新建工程预览合并 TS 非 EPUB 解析和 Python EPUB 桥结果", async () => {
    const txt_file = path.join(temp_dir, "script.txt");
    const epub_file = path.join(temp_dir, "book.epub");
    fs.writeFileSync(txt_file, "文本", "utf-8");
    fs.writeFileSync(epub_file, "epub", "utf-8");
    const core_bridge = {
      proxy_json: async () => ({
        draft: {
          items: [{ src: "章节", dst: "", file_type: "EPUB" }],
        },
      }),
    } as unknown as CoreBridgeClient;
    const service = new FilePreviewService(create_config_service(), core_bridge);

    const result = await service.build_create_preview({ source_paths: [txt_file, epub_file] });
    const draft = result["draft"] as {
      files: Array<{ rel_path: string; file_type: string }>;
      items: Array<{ id: number; src: string; file_type: string; file_path: string }>;
    };

    expect(draft.files.map((file) => [file.rel_path, file.file_type])).toEqual([
      ["script.txt", "TXT"],
      ["book.epub", "EPUB"],
    ]);
    expect(draft.items.map((item) => [item.id, item.src, item.file_type, item.file_path])).toEqual([
      [1, "文本", "TXT", "script.txt"],
      [2, "章节", "EPUB", "book.epub"],
    ]);
  });
});

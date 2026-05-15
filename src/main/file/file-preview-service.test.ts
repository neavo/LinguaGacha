import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { write_epub_fixture } from "../../test/epub-fixture";
import type { SettingService } from "../service/setting-service";
import { FilePreviewService } from "./file-preview-service";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-file-preview-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

function create_setting_service(): SettingService {
  return {
    load_setting: () => ({
      source_language: "JA",
      target_language: "ZH",
      app_language: "ZH",
      deduplication_in_bilingual: true,
      write_translated_name_fields_to_file: true,
    }),
  } as unknown as SettingService;
}

describe("FilePreviewService", () => {
  it("工作台预解析返回成功文件和结构化失败文件", async () => {
    const source_file = path.join(temp_dir, "script.txt");
    fs.writeFileSync(source_file, "原文", "utf-8");
    const service = new FilePreviewService(create_setting_service());

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
      failed_files: [
        {
          source_path: path.join(temp_dir, "missing.bin"),
          filename: "missing.bin",
          code: "file.unsupported_format",
          message_key: "app.error.file.unsupported_format.message",
        },
      ],
    });
  });

  it("工作台预解析 EPUB 时直接返回 解析结果", async () => {
    const epub_file = path.join(temp_dir, "book.epub");
    await write_epub_fixture(epub_file, "章节");
    const service = new FilePreviewService(create_setting_service());

    await expect(
      service.parse_workbench_file({
        source_paths: [epub_file],
        current_rel_path: "old/original.epub",
      }),
    ).resolves.toEqual({
      files: [
        {
          source_path: epub_file,
          target_rel_path: path.join("old", "book.epub"),
          file_type: "EPUB",
          parsed_items: [
            expect.objectContaining({
              src: "章节",
              file_type: "EPUB",
              file_path: path.join("old", "book.epub"),
            }),
          ],
        },
      ],
      failed_files: [],
    });
  });

  it("新建工程预览合并 文本和 EPUB 解析结果", async () => {
    const txt_file = path.join(temp_dir, "script.txt");
    const epub_file = path.join(temp_dir, "book.epub");
    fs.writeFileSync(txt_file, "文本", "utf-8");
    await write_epub_fixture(epub_file, "章节");
    const service = new FilePreviewService(create_setting_service());

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

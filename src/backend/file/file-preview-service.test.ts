import { create_pdf_execution } from "./pdf/test-support";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { write_epub_fixture } from "../../test/epub-fixture";
import type { AppSettingService } from "../app/app-setting-service";
import type { LogManager } from "../log/log-manager";
import { FilePreviewService } from "./file-preview-service";

/** 固定预览所需配置，隔离用户设置。 */
function create_setting_service(): AppSettingService {
  return {
    read_setting: () => ({
      source_language: "JA",
      target_language: "ZH",
      app_language: "ZH",
      deduplication_in_bilingual: true,
      write_translated_name_fields_to_file: true,
    }),
  } as unknown as AppSettingService;
}

describe("FilePreviewService", () => {
  it("新建工程预览合并文本和 EPUB 解析结果", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-file-preview-"));
    const txt_file = path.join(temp_dir.path, "script.txt");
    const epub_file = path.join(temp_dir.path, "book.epub");
    fs.writeFileSync(txt_file, "文本", "utf-8");
    await write_epub_fixture(epub_file, "章节");
    const service = new FilePreviewService(create_setting_service(), create_pdf_execution());

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

  it("新建工程预览跳过解析失败文件并保留成功文件", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-file-preview-"));
    const txt_file = path.join(temp_dir.path, "script.txt");
    const broken_json = path.join(temp_dir.path, "broken.json");
    fs.writeFileSync(txt_file, "文本", "utf-8");
    fs.writeFileSync(broken_json, "{", "utf-8");
    const service = new FilePreviewService(
      create_setting_service(),
      create_pdf_execution(),
      create_log_manager(),
    );

    const result = await service.build_create_preview({ source_paths: [txt_file, broken_json] });
    const draft = result["draft"] as { files: Array<{ rel_path: string }> };

    expect(draft.files.map((file) => file.rel_path)).toEqual(["script.txt"]);
    expect(result["failed_files"]).toEqual([
      {
        source_path: broken_json,
        rel_path: "broken.json",
        filename: "broken.json",
        code: "file.parse_failed",
        message: expect.any(String),
      },
    ]);
  });
});

/** 每次提供独立的诊断记录入口。 */
function create_log_manager(): Pick<LogManager, "warning"> {
  return {
    warning: vi.fn(),
  };
}

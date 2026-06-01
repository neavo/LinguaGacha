import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileFormatService } from "../file/file-format-service";
import { SourceFileParsePipeline } from "./source-file-parse-pipeline";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-source-file-pipeline-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

function create_format_service(): FileFormatService {
  return new FileFormatService({
    source_language: "JA",
    target_language: "ZH",
    app_language: "ZH",
    deduplication_in_bilingual: true,
    write_translated_name_fields_to_file: true,
  });
}

describe("SourceFileParsePipeline", () => {
  it("新建工程草稿跳过不支持格式，并保留支持格式解析失败明细", async () => {
    const source_file = path.join(temp_dir, "script.txt");
    const broken_json = path.join(temp_dir, "broken.json");
    const ignored_file = path.join(temp_dir, "noise.bin");
    fs.writeFileSync(source_file, "原文", "utf-8");
    fs.writeFileSync(broken_json, "{", "utf-8");
    fs.writeFileSync(ignored_file, "noise", "utf-8");
    const pipeline = new SourceFileParsePipeline(create_format_service());

    const draft = await pipeline.build_project_draft([source_file, broken_json, ignored_file]);

    expect(draft.files).toEqual([
      {
        rel_path: "script.txt",
        source_path: source_file,
        file_type: "TXT",
        sort_index: 0,
      },
    ]);
    expect(draft.items).toEqual([
      expect.objectContaining({
        id: 1,
        src: "原文",
        file_path: "script.txt",
        file_type: "TXT",
      }),
    ]);
    expect(draft.file_state).toEqual({
      "script.txt": {
        rel_path: "script.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    });
    expect(draft.failed_files).toEqual([
      {
        source_path: broken_json,
        rel_path: "broken.json",
        filename: "broken.json",
        code: "file.parse_failed",
        message_key: "app.error.file.parse_failed.message",
      },
    ]);
  });

  it("工作台导入命令只按调用方目标路径解析，不重新推导相对路径", async () => {
    const source_file = path.join(temp_dir, "script.txt");
    fs.writeFileSync(source_file, "原文", "utf-8");
    const pipeline = new SourceFileParsePipeline(create_format_service());

    const result = await pipeline.parse_import_commands([
      { source_path: source_file, rel_path: "nested/target.txt" },
    ]);

    expect(result.failed_files).toEqual([]);
    expect(result.file_drafts).toEqual([
      expect.objectContaining({
        source_path: source_file,
        rel_path: "nested/target.txt",
        file_type: "TXT",
        parsed_items: [
          expect.objectContaining({
            src: "原文",
            file_path: "nested/target.txt",
            file_type: "TXT",
          }),
        ],
      }),
    ]);
  });
});

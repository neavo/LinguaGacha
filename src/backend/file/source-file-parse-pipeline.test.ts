import { create_pdf_execution, create_pdf_fixture } from "./formats/pdf/test-support";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FileFormatService } from "../file/file-format-service";
import { SourceFileParsePipeline } from "./source-file-parse-pipeline";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectDataReader } from "../project/project-data-reader";

/** 固定解析配置，避免读取本机设置。 */
function create_format_service(): FileFormatService {
  return new FileFormatService(
    {
      target_language: "ZH",
      deduplication_in_bilingual: true,
      write_translated_name_fields_to_file: true,
    },
    create_pdf_execution(),
  );
}

describe("SourceFileParsePipeline", () => {
  it("预览、导入草稿与重新打开的文件类型一致，零条目文本为 NONE，PDF 保留身份", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-source-file-pipeline-"),
    );
    const samples = [
      ["empty.txt", ""],
      ["object.json", "{}"],
      ["array.json", "[]"],
      ["text.txt", "正文"],
      ["book.pdf", create_pdf_fixture()],
    ] as const;
    const source_paths = samples.map(([name, content]) => {
      const source_path = path.join(temp_dir.path, name);
      fs.writeFileSync(source_path, content);
      return source_path;
    });
    const expected_types = ["NONE", "NONE", "NONE", "TXT", "PDF"];
    const pipeline = new SourceFileParsePipeline(create_format_service());
    const preview = await pipeline.parse_project_file_preview({ source_paths });
    const draft = await pipeline.build_project_draft(source_paths);
    expect(preview.failed_files).toEqual([]);
    expect(draft.failed_files).toEqual([]);
    expect(preview.files.map((file) => file["file_type"])).toEqual(expected_types);
    expect(draft.files.map((file) => file.file_type)).toEqual(expected_types);

    const database = new ProjectDatabase();
    const project_path = path.join(temp_dir.path, "project.lg");
    try {
      database.create_project(project_path, "文件类型", () => {
        for (const file of draft.files) {
          database.add_asset_from_source(
            project_path,
            file.rel_path,
            file.source_path,
            file.pdf_document,
            file.sort_index,
          );
        }
        database.set_items(project_path, draft.items);
      });
      const reader = new ProjectDataReader(database);
      // create_project 已结束 scoped 连接，此次读取会重新打开真实 .lg。
      expect(
        Object.values(reader.build_files_record_block(project_path)).map(
          (file) => (file as { file_type: string }).file_type,
        ),
      ).toEqual(expected_types);
    } finally {
      database.close();
    }
  });

  it("新建工程草稿跳过不支持格式，并保留支持格式解析失败明细", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-source-file-pipeline-"),
    );
    const source_file = path.join(temp_dir.path, "script.txt");
    const broken_json = path.join(temp_dir.path, "broken.json");
    const ignored_file = path.join(temp_dir.path, "noise.bin");
    fs.writeFileSync(source_file, "原文", "utf-8");
    fs.writeFileSync(broken_json, "{", "utf-8");
    fs.writeFileSync(ignored_file, "noise", "utf-8");
    const pipeline = new SourceFileParsePipeline(create_format_service());

    const draft = await pipeline.build_project_draft([source_file, broken_json, ignored_file]);

    expect(draft.files).toEqual([
      {
        rel_path: "script.txt",
        source_path: source_file,
        pdf_document: null,
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
      },
    ]);
  });

  it("项目文件导入命令只按调用方目标路径解析，不重新推导相对路径", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-source-file-pipeline-"),
    );
    const source_file = path.join(temp_dir.path, "script.txt");
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

  it("项目文件替换预览沿用旧相对目录", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-source-file-pipeline-"),
    );
    const source_file = path.join(temp_dir.path, "new.txt");
    fs.writeFileSync(source_file, "新文本", "utf-8");
    const pipeline = new SourceFileParsePipeline(create_format_service());

    await expect(
      pipeline.parse_project_file_preview({
        source_paths: [source_file],
        current_rel_path: "old/path/original.txt",
      }),
    ).resolves.toEqual({
      files: [
        expect.objectContaining({
          source_path: source_file,
          target_rel_path: path.join("old/path", "new.txt"),
          file_type: "TXT",
        }),
      ],
      failed_files: [],
    });
  });
});

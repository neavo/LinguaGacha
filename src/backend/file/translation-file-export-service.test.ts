import { read_pdf_document } from "./formats/pdf/pdf-document";
import { create_pdf_execution } from "./formats/pdf/test-support";
import { create_pdf_fixture } from "./formats/pdf/test-support";
import type { PDFDocument } from "../../shared/pdf";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import { default_native_fs } from "../../native/native-fs";
import { create_text_resolver } from "../../shared/i18n";
import { AppError } from "../../shared/error";
import type { AppSettingService } from "../app/app-setting-service";
import { ProjectSessionState } from "../project/project-session-state";
import {
  TranslationFileExportService,
  type OutputFolderOpener,
} from "./translation-file-export-service";

let temp_dir = "";
beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-file-export-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

/** 只提供导出消费的设置，避免启动应用配置存储。 */
function create_setting_service(
  options: {
    app_language?: string;
    output_folder_open_on_finish?: boolean;
  } = {},
): AppSettingService {
  return {
    read_setting: () => ({
      source_language: "JA",
      target_language: "ZH",
      app_language: options.app_language ?? "ZH",
      output_folder_open_on_finish: options.output_folder_open_on_finish ?? false,
      deduplication_in_bilingual: true,
      write_translated_name_fields_to_file: true,
    }),
  } as unknown as AppSettingService;
}

/** 隔离数据库读取，文件写出仍使用真实格式处理器和临时目录。 */
function create_database(
  items: Array<Record<string, unknown>>,
  assets: Record<string, Buffer> = {},
  documents: Record<string, PDFDocument> = {},
): ProjectDatabase {
  return {
    read_pdf_summaries: () =>
      Object.fromEntries(Object.keys(documents).map((file_path) => [file_path, {}])),
    read_pdf_document: (_project_path: string, file_path: string) => documents[file_path] ?? null,
    get_all_items: () => items,
    read_asset_content: (_project_path: string, rel_path: string) => assets[rel_path] ?? null,
  } as unknown as ProjectDatabase;
}

describe("TranslationFileExportService", () => {
  it.each(["gui", "directory", "single"] as const)(
    "%s 在工程语言变化后导出已存译稿并保留原页，无译稿文件原样写出",
    async (entry) => {
      const source = create_pdf_fixture();
      const document = read_pdf_document(source);
      const partial: PDFDocument = {
        ...document,
        translation: {
          sections: [{ page_start: 2, page_end: 2, markdown: "已有译稿" }],
          reviewed_pages: [],
          notes: "待继续",
        },
      };
      const database = create_database(
        [],
        { "book.pdf": Buffer.from(source), "original.pdf": Buffer.from(source) },
        { "book.pdf": partial, "original.pdf": document },
      );
      const session = new ProjectSessionState();
      session.mark_loaded(path.join(temp_dir, "project.lg"));
      const host = vi.fn(async () => create_pdf_fixture(["Translated"]));
      const settings = create_setting_service();
      const service = new TranslationFileExportService(
        database,
        settings,
        session,
        async () => {},
        create_pdf_execution(host),
        undefined,
        default_native_fs,
      );
      vi.spyOn(settings, "read_setting").mockReturnValue({
        ...settings.read_setting(),
        source_language: "ALL",
        target_language: "DE",
      });
      if (entry === "single") {
        const result = await service.export_pdf_file("book.pdf");
        const exported = read_pdf_document(new Uint8Array(fs.readFileSync(result.output_path)));
        expect(exported.source.pages).toHaveLength(3);
        const original = await service.export_pdf_file("original.pdf");
        expect(fs.readFileSync(original.output_path)).toEqual(Buffer.from(source));
      } else {
        const result =
          entry === "gui"
            ? await service.export_files()
            : await service.export_files_to_directory(path.join(temp_dir, "out"));
        expect(result.pdf_files).toEqual([
          { file_path: "book.pdf", translated_pages: 1, original_pages: 2 },
          { file_path: "original.pdf", translated_pages: 0, original_pages: 3 },
        ]);
        expect(fs.readFileSync(path.join(result.output_path, "original.pdf"))).toEqual(
          Buffer.from(source),
        );
        const exported = read_pdf_document(
          new Uint8Array(fs.readFileSync(path.join(result.output_path, "book.pdf"))),
        );
        expect(exported.source.pages).toHaveLength(3);
      }
      expect(host).toHaveBeenCalledTimes(1);
      expect(partial.translation?.sections).toHaveLength(1);
    },
  );

  it("原文导出不要求打印宿主，译稿范围错误在文本文件落盘前报告", async () => {
    const source = create_pdf_fixture();
    const document = read_pdf_document(source);
    const database = create_database(
      [
        {
          id: 1,
          src: "source",
          dst: "text",
          status: "PROCESSED",
          file_type: "TXT",
          file_path: "text.txt",
          row: 0,
        },
      ],
      { "book.pdf": Buffer.from(source) },
      { "book.pdf": document },
    );
    const session = new ProjectSessionState();
    session.mark_loaded(path.join(temp_dir, "project.lg"));
    const service = new TranslationFileExportService(
      database,
      create_setting_service(),
      session,
      async () => {},
      create_pdf_execution(),
    );
    const output = await service.export_pdf_file("book.pdf");
    expect(fs.readFileSync(output.output_path)).toEqual(Buffer.from(source));
    document.translation = {
      sections: [{ page_start: 1, page_end: 4, markdown: "translation" }],
      reviewed_pages: [],
      notes: "",
    };
    const directory = path.join(temp_dir, "conflict");
    await expect(service.export_files_to_directory(directory)).rejects.toMatchObject({
      code: "file.invalid_structure",
      public_details: { file: "book.pdf" },
    });
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("普通导出补齐同文件重复译文并写出 TXT 格式文件", async () => {
    const project_path = path.join(temp_dir, "demo.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const database = create_database([
      {
        id: 1,
        src: "原文",
        dst: "译文",
        status: "PROCESSED",
        file_type: "TXT",
        file_path: "script.txt",
        row: 0,
      },
      {
        id: 2,
        src: "原文",
        dst: "",
        status: "DUPLICATED",
        file_type: "TXT",
        file_path: "script.txt",
        row: 1,
      },
    ]);
    const output_folder_opener = vi.fn<OutputFolderOpener>();
    const service = new TranslationFileExportService(
      database,
      create_setting_service(),
      session_state,
      output_folder_opener,
      create_pdf_execution(),
    );

    const result = await service.export_files();
    expect(fs.readFileSync(path.join(String(result.output_path), "script.txt"), "utf-8")).toBe(
      "译文\n译文",
    );
    expect(output_folder_opener).not.toHaveBeenCalled();
  });

  it("MESSAGEJSON 导出只在相同可见角色间复用译文", async () => {
    const project_path = path.join(temp_dir, "actors.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const database = create_database([
      {
        id: 1,
        src: "あうぅ……。",
        dst: "嗷呜……。",
        name_src: "アビゲイル",
        name_dst: "阿比盖尔",
        status: "PROCESSED",
        file_type: "MESSAGEJSON",
        file_path: "actors.json",
        text_type: "KAG",
        row: 0,
      },
      {
        id: 2,
        src: "あうぅ……。",
        dst: "",
        name_src: "アビゲイル",
        name_dst: null,
        status: "DUPLICATED",
        file_type: "MESSAGEJSON",
        file_path: "actors.json",
        text_type: "KAG",
        row: 1,
      },
      {
        id: 3,
        src: "あうぅ……。",
        dst: "",
        name_src: "武藏",
        name_dst: null,
        status: "DUPLICATED",
        file_type: "MESSAGEJSON",
        file_path: "actors.json",
        text_type: "KAG",
        row: 2,
      },
    ]);
    const service = new TranslationFileExportService(
      database,
      create_setting_service(),
      session_state,
      vi.fn<OutputFolderOpener>(),
      create_pdf_execution(),
    );

    const result = await service.export_files();

    expect(
      JSON.parse(fs.readFileSync(path.join(String(result.output_path), "actors.json"), "utf-8")),
    ).toEqual([
      { name: "阿比盖尔", message: "嗷呜……。" },
      { name: "阿比盖尔", message: "嗷呜……。" },
      { name: "武藏", message: "あうぅ……。" },
    ]);
  });

  it("导出时直接写出 Markdown 块中的资源引用", async () => {
    const project_path = path.join(temp_dir, "mixed.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const source = "# 标题\n\n![封面](data:image/png;base64,AAAA)\n";
    const database = create_database(
      [
        {
          id: 1,
          src: "# 标题",
          dst: "# Title",
          status: "PROCESSED",
          file_type: "MD_V2",
          file_path: "readme.md",
          row: 0,
          extra_field: { markdown: { before: "", after: "" } },
        },
        {
          id: 2,
          src: "![封面](data:image/png;base64,AAAA)",
          dst: "![Cover](data:image/png;base64,AAAA)",
          status: "PROCESSED",
          file_type: "MD_V2",
          file_path: "readme.md",
          row: 2,
          extra_field: { markdown: { before: "\n\n", after: "\n" } },
        },
      ],
      { "readme.md": Buffer.from(source) },
    );
    const service = new TranslationFileExportService(
      database,
      create_setting_service(),
      session_state,
      vi.fn<OutputFolderOpener>(),
      create_pdf_execution(),
    );

    const result = await service.export_files();

    expect(fs.readFileSync(path.join(String(result.output_path), "readme.md"), "utf-8")).toBe(
      "# Title\n\n![Cover](data:image/png;base64,AAAA)\n",
    );
  });

  it("德语界面使用德语导出目录名和日志", async () => {
    const project_path = path.join(temp_dir, "demo.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const database = create_database([
      {
        id: 1,
        src: "原文",
        dst: "Übersetzung",
        status: "PROCESSED",
        file_type: "TXT",
        file_path: "script.txt",
        row: 0,
      },
    ]);
    const log_collector = { info: vi.fn(), error: vi.fn() };
    const service = new TranslationFileExportService(
      database,
      create_setting_service({ app_language: "DE" }),
      session_state,
      vi.fn<OutputFolderOpener>(),
      create_pdf_execution(),
      log_collector,
    );
    const text = create_text_resolver("de-DE"); // 验证语言选择与参数传递，文案由当前词典决定。
    const translated_path = path.join(
      temp_dir,
      `demo_${text("app.translation_export.directory.translated")}`,
    );
    const bilingual_path = path.join(
      temp_dir,
      `demo_${text("app.translation_export.directory.bilingual")}`,
    );

    await expect(service.export_files()).resolves.toEqual({
      accepted: true,
      pdf_files: [],
      output_path: translated_path,
    });

    expect(fs.readFileSync(path.join(translated_path, "script.txt"), "utf-8")).toBe("Übersetzung");
    expect(fs.existsSync(path.join(bilingual_path, "script.txt"))).toBe(true);
    expect(log_collector.info).toHaveBeenCalledWith(
      text("app.log.generate_translation_done", { PATH: translated_path }),
      { source: "file-export" },
    );
  });

  it("启用设置后导出成功会打开译文输出目录", async () => {
    const project_path = path.join(temp_dir, "demo.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const database = create_database([
      {
        id: 1,
        src: "原文",
        dst: "译文",
        status: "PROCESSED",
        file_type: "TXT",
        file_path: "script.txt",
        row: 0,
      },
    ]);
    const output_folder_opener = vi.fn<OutputFolderOpener>().mockResolvedValue(undefined);
    const service = new TranslationFileExportService(
      database,
      create_setting_service({ output_folder_open_on_finish: true }),
      session_state,
      output_folder_opener,
      create_pdf_execution(),
    );

    const result = await service.export_files();
    expect(output_folder_opener).toHaveBeenCalledExactlyOnceWith(result.output_path);
  });

  it("CLI 导出写入指定 output-dir 并固定生成 bilingual 子目录", async () => {
    const project_path = path.join(temp_dir, "demo.lg");
    const output_dir = path.join(temp_dir, "cli-out");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const database = create_database([
      {
        id: 1,
        src: "原文",
        dst: "译文",
        status: "PROCESSED",
        file_type: "TXT",
        file_path: "script.txt",
        row: 0,
      },
    ]);
    const output_folder_opener = vi.fn<OutputFolderOpener>();
    const service = new TranslationFileExportService(
      database,
      create_setting_service({ output_folder_open_on_finish: true }),
      session_state,
      output_folder_opener,
      create_pdf_execution(),
    );

    await expect(service.export_files_to_directory(output_dir)).resolves.toEqual({
      accepted: true,
      pdf_files: [],
      output_path: output_dir,
      bilingual_output_path: path.join(output_dir, "bilingual"),
    });

    expect(fs.readFileSync(path.join(output_dir, "script.txt"), "utf-8")).toBe("译文");
    expect(fs.existsSync(path.join(output_dir, "bilingual", "script.txt"))).toBe(true);
    expect(output_folder_opener).not.toHaveBeenCalled();
  });

  it("打开输出目录失败不改变导出成功结果并记录诊断日志", async () => {
    const project_path = path.join(temp_dir, "demo.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const database = create_database([
      {
        id: 1,
        src: "原文",
        dst: "译文",
        status: "PROCESSED",
        file_type: "TXT",
        file_path: "script.txt",
        row: 0,
      },
    ]);
    const log_collector = { info: vi.fn(), error: vi.fn() };
    const error = new Error("open failed");
    const output_folder_opener = vi.fn<OutputFolderOpener>().mockRejectedValue(error);
    const service = new TranslationFileExportService(
      database,
      create_setting_service({ output_folder_open_on_finish: true }),
      session_state,
      output_folder_opener,
      create_pdf_execution(),
      log_collector,
    );

    await expect(service.export_files()).resolves.toMatchObject({ accepted: true });

    expect(log_collector.error).toHaveBeenCalledExactlyOnceWith(
      create_text_resolver("zh-CN")("app.diagnostic.file_export.open_output_folder_failed"),
      { source: "file-export", error },
    );
  });

  it.each(["gui-write", "directory-prepare", "single-pdf"] as const)(
    "%s 失败时统一报告导出错误并保留一份原始诊断",
    async (entry) => {
      const project_path = path.join(temp_dir, "demo.lg");
      const session_state = new ProjectSessionState();
      session_state.mark_loaded(project_path);
      const source = create_pdf_fixture();
      const document = read_pdf_document(source);
      document.translation = {
        sections: [{ page_start: 1, page_end: 1, markdown: "译文" }],
        reviewed_pages: [],
        notes: "",
      };
      const database = create_database(
        [
          {
            id: 1,
            src: "原文",
            dst: "译文",
            status: "PROCESSED",
            file_type: "TXT",
            file_path: "script.txt",
            row: 0,
          },
        ],
        { "book.pdf": Buffer.from(source) },
        { "book.pdf": document },
      );
      const log_collector = { info: vi.fn(), error: vi.fn() };
      const cause = new Error("底层原因");
      const error = new Error("导出故障", { cause });
      const write_file = vi.spyOn(default_native_fs, "write_file");
      if (entry === "gui-write") write_file.mockRejectedValue(error);
      if (entry === "directory-prepare") {
        vi.spyOn(default_native_fs, "make_dir").mockImplementation(() => {
          throw error;
        });
      }
      const execute = create_pdf_execution();
      const service = new TranslationFileExportService(
        database,
        create_setting_service({ output_folder_open_on_finish: true }),
        session_state,
        vi.fn<OutputFolderOpener>(),
        entry === "single-pdf"
          ? async () => {
              throw error;
            }
          : execute,
        log_collector,
      );

      const result =
        entry === "gui-write"
          ? service.export_files()
          : entry === "directory-prepare"
            ? service.export_files_to_directory(path.join(temp_dir, "out"))
            : service.export_pdf_file("book.pdf");
      await expect(result).rejects.toMatchObject({
        code: "translation.export_failed",
        cause: error,
      });

      const text = create_text_resolver("zh-CN");
      expect(log_collector.error).toHaveBeenCalledExactlyOnceWith(
        text("app.error.translation.export_failed.message"),
        { source: "file-export", error },
      );
      expect(log_collector.info).toHaveBeenCalledExactlyOnceWith(
        text("app.log.generate_translation_start"),
        { source: "file-export" },
      );
      if (entry !== "gui-write") expect(write_file).not.toHaveBeenCalled();
    },
  );

  it("已有业务错误保留原始错误码和详情", async () => {
    const session = new ProjectSessionState();
    session.mark_loaded(path.join(temp_dir, "project.lg"));
    const database = create_database([]);
    const error = new AppError("file.invalid_structure", { public_details: { file: "book.epub" } });
    vi.spyOn(database, "get_all_items").mockImplementation(() => {
      throw error;
    });
    const service = new TranslationFileExportService(
      database,
      create_setting_service(),
      session,
      async () => {},
      create_pdf_execution(),
    );
    await expect(service.export_files()).rejects.toBe(error);
  });
});

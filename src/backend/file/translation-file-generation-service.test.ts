import { read_pdf_document } from "./pdf/pdf-document";
import { create_pdf_execution, create_pdf_fixture } from "./pdf/test-support";
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
  TranslationFileGenerationService,
  type OutputFolderOpener,
} from "./translation-file-generation-service";

let temp_dir = "";
beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-file-generation-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

/** 只提供译文生成消费的设置，避免启动应用配置存储。 */
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
    get_all_asset_records: () =>
      Object.keys(assets).map((path, sort_order) => ({ path, sort_order })),
    read_asset_content: (_project_path: string, rel_path: string) => assets[rel_path] ?? null,
  } as unknown as ProjectDatabase;
}

describe("TranslationFileGenerationService", () => {
  it("旧 ASS／SRT 条目通过新字幕入口导出，条目事实无需迁移", async () => {
    const time = "00:00:01,000 --> 00:00:02,000";
    const fields =
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";
    const prefix = "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,";
    const items = [
      {
        id: 1,
        row: 0,
        src: "",
        file_type: "ASS",
        file_path: "old/sub.txt",
        extra_field: "[Events]",
      },
      { id: 2, row: 1, src: "", file_type: "ASS", file_path: "old/sub.txt", extra_field: fields },
      {
        id: 3,
        row: 2,
        src: "原文",
        dst: "译文",
        status: "PROCESSED",
        file_type: "ASS",
        file_path: "old/sub.txt",
        extra_field: "错误{{CONTENT}}模板",
      },
      {
        id: 4,
        row: 7,
        src: "原文",
        dst: "译文",
        status: "PROCESSED",
        file_type: "SRT",
        file_path: "old/sub.srt",
        extra_field: time,
      },
    ];
    const before = structuredClone(items);
    const session = new ProjectSessionState();
    session.mark_loaded(path.join(temp_dir, "legacy.lg"));
    const service = new TranslationFileGenerationService(
      create_database(items, {
        "old/sub.txt": Buffer.from(`[Events]\n${fields}\n${prefix}原文\n`),
        "old/sub.srt": Buffer.from(`7\n${time}\n原文\n\n`),
      }),
      create_setting_service(),
      session,
      async () => {},
      create_pdf_execution(),
    );
    const result = await service.generate_files_to_directory(path.join(temp_dir, "legacy"));
    expect(fs.readFileSync(path.join(result.output_path, "old/sub.txt"), "utf8")).toBe(
      `[Events]\n${fields}\n${prefix}译文\n`,
    );
    expect(fs.readFileSync(path.join(result.output_path, "old/sub.srt"), "utf8")).toBe(
      `1\n${time}\n译文\n\n`,
    );
    expect(items).toEqual(before);
  });

  it.each(["gui", "directory"] as const)(
    "%s 导出零条目字幕，目录入口同时排除零条目文件",
    async (entry) => {
      const assets = {
        "empty.vtt": Buffer.from("WEBVTT\n\nNOTE structure\n"),
        "empty.lrc": Buffer.from("[offset:50]\n[00:01]\n"),
        "empty.ssa": Buffer.from("[Events]\n"),
      };
      const session = new ProjectSessionState();
      session.mark_loaded(path.join(temp_dir, "empty.lg"));
      const service = new TranslationFileGenerationService(
        create_database([], assets),
        create_setting_service(),
        session,
        async () => {},
        create_pdf_execution(),
      );
      const result =
        entry === "gui"
          ? await service.generate_files()
          : await service.generate_files_to_directory(path.join(temp_dir, "out"), ["empty.lrc"]);
      for (const [file, content] of Object.entries(assets)) {
        if (entry === "directory" && file === "empty.lrc") {
          expect(fs.existsSync(path.join(result.output_path, file))).toBe(false);
        } else {
          expect(fs.readFileSync(path.join(result.output_path, file))).toEqual(content);
        }
      }
    },
  );

  it.each(["gui", "directory"] as const)(
    "%s 译文生成已存译稿与确认保留的原页，全保留文件原样写出",
    async (entry) => {
      const source = create_pdf_fixture();
      const document = read_pdf_document(source);
      const partial = structuredClone(document);
      partial.pages[0]!.translation = { kind: "keep", reason: "无需翻译" };
      partial.pages[1]!.translation = { kind: "translate", markdown: "已有译稿" };
      partial.pages[2]!.translation = { kind: "omit", reason: "装饰空页" };
      for (const page of document.pages)
        page.translation = { kind: "keep", reason: "按用户要求保留原稿" };
      const empty = structuredClone(document);
      for (const page of empty.pages) page.translation = { kind: "omit", reason: "省略" };
      const database = create_database(
        [],
        {
          "book.pdf": Buffer.from(source),
          "original.pdf": Buffer.from(source),
          "empty.pdf": Buffer.from(source),
        },
        { "book.pdf": partial, "original.pdf": document, "empty.pdf": empty },
      );
      const session = new ProjectSessionState();
      session.mark_loaded(path.join(temp_dir, "project.lg"));
      const host = vi.fn(async () => create_pdf_fixture(["Translated"]));
      const service = new TranslationFileGenerationService(
        database,
        create_setting_service(),
        session,
        async () => {},
        create_pdf_execution(host),
      );
      const result =
        entry === "gui"
          ? await service.generate_files()
          : await service.generate_files_to_directory(path.join(temp_dir, "out"));
      expect(result.pdf_files).toEqual([
        {
          file_path: "book.pdf",
          written: true,
          translated_pages: 1,
          original_pages: 1,
          omitted_pages: 1,
        },
        {
          file_path: "original.pdf",
          written: true,
          translated_pages: 0,
          original_pages: 3,
          omitted_pages: 0,
        },
        {
          file_path: "empty.pdf",
          written: false,
          translated_pages: 0,
          original_pages: 0,
          omitted_pages: empty.pages.length,
        },
      ]);
      expect(fs.readFileSync(path.join(result.output_path, "original.pdf"))).toEqual(
        Buffer.from(source),
      );
      const exported = read_pdf_document(
        new Uint8Array(fs.readFileSync(path.join(result.output_path, "book.pdf"))),
      );
      expect(exported.pages).toHaveLength(2);
      expect(host).toHaveBeenCalledTimes(1);
    },
  );

  it("原文译文生成不要求打印宿主，页面顺序错误在文本文件落盘前报告", async () => {
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
    const service = new TranslationFileGenerationService(
      database,
      create_setting_service(),
      session,
      async () => {},
      create_pdf_execution(),
    );
    const output = await service.generate_files();
    expect(fs.readFileSync(path.join(output.output_path, "book.pdf"))).toEqual(Buffer.from(source));
    document.pages[0]!.page = 4;
    const directory = path.join(temp_dir, "conflict");
    await expect(service.generate_files_to_directory(directory)).rejects.toMatchObject({
      code: "file.invalid_structure",
      public_details: { file: "book.pdf" },
    });
    expect(fs.existsSync(directory)).toBe(false);
  });

  it.each(["译文", ""])("普通译文生成复用已完成正文 %j 并写出 TXT", async (dst) => {
    const project_path = path.join(temp_dir, "demo.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const database = create_database([
      {
        id: 1,
        src: "原文",
        dst,
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
    const service = new TranslationFileGenerationService(
      database,
      create_setting_service(),
      session_state,
      output_folder_opener,
      create_pdf_execution(),
    );

    const result = await service.generate_files();
    expect(fs.readFileSync(path.join(String(result.output_path), "script.txt"), "utf-8")).toBe(
      `${dst}\n${dst}`,
    );
    expect(output_folder_opener).not.toHaveBeenCalled();
  });

  it("MESSAGEJSON 译文生成只在相同可见角色间复用译文", async () => {
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
    const service = new TranslationFileGenerationService(
      database,
      create_setting_service(),
      session_state,
      vi.fn<OutputFolderOpener>(),
      create_pdf_execution(),
    );

    const result = await service.generate_files();

    expect(
      JSON.parse(fs.readFileSync(path.join(String(result.output_path), "actors.json"), "utf-8")),
    ).toEqual([
      { name: "阿比盖尔", message: "嗷呜……。" },
      { name: "阿比盖尔", message: "嗷呜……。" },
      { name: "武藏", message: "あうぅ……。" },
    ]);
  });

  it("译文生成时直接写出 Markdown 块中的资源引用", async () => {
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
    const service = new TranslationFileGenerationService(
      database,
      create_setting_service(),
      session_state,
      vi.fn<OutputFolderOpener>(),
      create_pdf_execution(),
    );

    const result = await service.generate_files();

    expect(fs.readFileSync(path.join(String(result.output_path), "readme.md"), "utf-8")).toBe(
      "# Title\n\n![Cover](data:image/png;base64,AAAA)\n",
    );
  });

  it("德语界面使用德语译文生成目录名和日志", async () => {
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
    const service = new TranslationFileGenerationService(
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
      `demo_${text("app.translation_generation.directory.translated")}`,
    );
    const bilingual_path = path.join(
      temp_dir,
      `demo_${text("app.translation_generation.directory.bilingual")}`,
    );

    await expect(service.generate_files()).resolves.toEqual({
      accepted: true,
      pdf_files: [],
      output_path: translated_path,
    });

    expect(fs.readFileSync(path.join(translated_path, "script.txt"), "utf-8")).toBe("Übersetzung");
    expect(fs.existsSync(path.join(bilingual_path, "script.txt"))).toBe(true);
    expect(log_collector.info).toHaveBeenNthCalledWith(
      2,
      `${text("app.translation_generation.log.succeeded")}\n${translated_path}`,
      { source: "translation-generation" },
    );
  });

  it("启用设置后译文生成成功会打开译文输出目录", async () => {
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
    const service = new TranslationFileGenerationService(
      database,
      create_setting_service({ output_folder_open_on_finish: true }),
      session_state,
      output_folder_opener,
      create_pdf_execution(),
    );

    const result = await service.generate_files();
    expect(output_folder_opener).toHaveBeenCalledExactlyOnceWith(result.output_path);
  });

  it("CLI 译文生成写入指定 output-dir 并固定生成 bilingual 子目录", async () => {
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
    const service = new TranslationFileGenerationService(
      database,
      create_setting_service({ output_folder_open_on_finish: true }),
      session_state,
      output_folder_opener,
      create_pdf_execution(),
    );

    await expect(service.generate_files_to_directory(output_dir)).resolves.toEqual({
      accepted: true,
      pdf_files: [],
      output_path: output_dir,
      bilingual_output_path: path.join(output_dir, "bilingual"),
    });

    expect(fs.readFileSync(path.join(output_dir, "script.txt"), "utf-8")).toBe("译文");
    expect(fs.existsSync(path.join(output_dir, "bilingual", "script.txt"))).toBe(true);
    expect(output_folder_opener).not.toHaveBeenCalled();
  });

  it("打开输出目录失败不改变译文生成成功结果并记录诊断日志", async () => {
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
    const service = new TranslationFileGenerationService(
      database,
      create_setting_service({ output_folder_open_on_finish: true }),
      session_state,
      output_folder_opener,
      create_pdf_execution(),
      log_collector,
    );

    await expect(service.generate_files()).resolves.toMatchObject({ accepted: true });

    expect(log_collector.error).toHaveBeenCalledExactlyOnceWith(
      create_text_resolver("zh-CN")("app.translation_generation.log.open_output_folder_failed"),
      { source: "translation-generation", error },
    );
  });

  it.each(["gui-write", "directory-prepare", "directory-pdf"] as const)(
    "%s 失败时统一报告译文生成错误并保留一份原始诊断",
    async (entry) => {
      const project_path = path.join(temp_dir, "demo.lg");
      const session_state = new ProjectSessionState();
      session_state.mark_loaded(project_path);
      const source = create_pdf_fixture();
      const document = read_pdf_document(source);
      document.pages[0]!.translation = { kind: "translate", markdown: "译文" };
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
      const error = new Error("译文生成故障", { cause });
      const write_file = vi.spyOn(default_native_fs, "write_file");
      if (entry === "gui-write") write_file.mockRejectedValue(error);
      if (entry === "directory-prepare") {
        vi.spyOn(default_native_fs, "make_dir").mockImplementation(() => {
          throw error;
        });
      }
      const execute = create_pdf_execution();
      const service = new TranslationFileGenerationService(
        database,
        create_setting_service({ output_folder_open_on_finish: true }),
        session_state,
        vi.fn<OutputFolderOpener>(),
        entry === "directory-pdf"
          ? async () => {
              throw error;
            }
          : execute,
        log_collector,
      );

      const result =
        entry === "gui-write"
          ? service.generate_files()
          : service.generate_files_to_directory(path.join(temp_dir, "out"));
      await expect(result).rejects.toMatchObject({
        code: "translation.generation_failed",
        cause: error,
      });

      const text = create_text_resolver("zh-CN");
      expect(log_collector.error).toHaveBeenCalledExactlyOnceWith(
        {
          kind: "text",
          text: `${text("app.translation_generation.log.failed")}\n${error.message}`,
        },
        { source: "translation-generation", error },
      );
      expect(log_collector.info).toHaveBeenCalledExactlyOnceWith(
        text("app.translation_generation.log.started"),
        { source: "translation-generation" },
      );
      if (entry === "directory-prepare") expect(write_file).not.toHaveBeenCalled();
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
    const service = new TranslationFileGenerationService(
      database,
      create_setting_service(),
      session,
      async () => {},
      create_pdf_execution(),
    );
    await expect(service.generate_files()).rejects.toBe(error);
  });
});

import { RuntimeOperationGate } from "../runtime-operation-gate";
import { GameDirectoryOperations } from "./shared/game/game-directory-operations";
import type { ProjectDatabaseAccess } from "../database/database-operations";
import { write_zip } from "../../test/zip-fixture";
import { GenericFormat } from "./generic/generic-format";
import { create_epub_fixture } from "../../test/epub-fixture";
import { EPUBFormat } from "./epub/epub-format";
import { create_item } from "../../domain/item";
import { image_fixture } from "../../test/image-fixture";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { default_native_fs } from "../../native/native-fs";
import { create_text_resolver } from "../../shared/i18n";
import { AppError } from "../../shared/error";
import type { AppSettingService } from "../app/app-setting-service";
import { ProjectSessionState } from "../project/project-session-state";
import { FileFormatService } from "./file-format-service";
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
    translation_save_mode?: "PROJECT" | "FIXED" | "MANUAL";
    translation_fixed_path?: string;
  } = {},
): AppSettingService {
  return {
    read_setting: () => ({
      ...options,
      app_language: options.app_language ?? "ZH",
      output_folder_open_on_finish: options.output_folder_open_on_finish ?? false,
    }),
  } as unknown as AppSettingService;
}

/** 隔离数据库读取，文件写出仍使用真实格式处理器和临时目录。 */
function create_database(
  items: Array<Record<string, unknown>>,
  assets: Record<string, { content: Buffer; file_type: string }> = Object.fromEntries(
    items.map((item) => [
      String(item.file_path),
      { content: Buffer.from(String(item.src ?? "")), file_type: String(item.file_type) },
    ]),
  ),
  meta: Record<string, unknown> = {},
): ProjectDatabase {
  return {
    get_all_meta: () => meta,
    async read<T>(_path: string, callback: (reader: ProjectDatabaseAccess) => T): Promise<T> {
      return callback(this as unknown as ProjectDatabaseAccess);
    },
    get_all_items: () => items,
    get_all_asset_records: () =>
      Object.entries(assets).map(([path, asset], sort_order) => ({
        path,
        sort_order,
        file_type: asset.file_type,
      })),
    read_asset_content: (_project_path: string, rel_path: string) =>
      assets[rel_path]?.content ?? null,
  } as unknown as ProjectDatabase;
}

describe("TranslationFileGenerationService", () => {
  it("图片交给 Agent 写回并沿用同组译文", async () => {
    const fixture = image_fixture(["completed", "duplicated"]);
    const cover = image_fixture(["cover"]);
    cover.book.pages[0]!.regions = [];
    cover.records.pop();
    const items = fixture.records.map((record, row) =>
      create_item({
        id: row + 1,
        src: record.message,
        row,
        file_path: "book.image",
        file_type: "IMAGE",
        status: row === 0 ? "PROCESSED" : "DUPLICATED",
        dst: row === 0 ? "同组译文" : "",
      }),
    );
    items.push(
      create_item({
        id: items.length + 1,
        src: "保留文本",
        dst: "文本译文",
        status: "PROCESSED",
        file_path: "plain.txt",
        file_type: "TXT",
      }),
    );
    const session = new ProjectSessionState();
    session.mark_loaded(path.join(temp_dir, "book.lg"));
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      create_database(items, {
        "book.image": { content: Buffer.from(await fixture.pack()), file_type: "IMAGE" },
        "cover.image": { content: Buffer.from(await cover.pack()), file_type: "IMAGE" },
        "plain.txt": { content: Buffer.from("保留文本"), file_type: "TXT" },
      }),
      create_setting_service(),
      session,
      async () => {},
    );
    const generated = await service.generate_staging_files(path.join(temp_dir, "staging"));
    expect(generated.writeback?.files).toEqual(["book.image", "cover.image"]);
    expect(fs.readdirSync(generated.output_path)).toEqual(["plain.txt"]);
    const direct = await service.generate_files({
      project_path: path.join(temp_dir, "book.lg"),
      expected_section_revisions: { files: 0 },
    });
    expect(direct.excluded_files).toEqual(["book.image", "cover.image"]);
    expect(fs.readdirSync(direct.output_path)).toEqual(["plain.txt"]);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(generated.writeback!.input_path, "cover.image", "items.json"),
          "utf8",
        ),
      ),
    ).toEqual([]);
    const snapshot = path.join(generated.writeback!.input_path, "book.image", "items.json");
    expect(JSON.parse(fs.readFileSync(snapshot, "utf8"))).toEqual([
      { pageId: "completed", regionId: "text", output: "translated", text: "同组译文" },
      { pageId: "duplicated", regionId: "text", output: "translated", text: "同组译文" },
    ]);
    expect(items[1]!.status).toBe("DUPLICATED");
  });
  it("仅含写回资产时直接生成报告排除清单，且不创建目录", async () => {
    const session = new ProjectSessionState();
    const project_path = path.join(temp_dir, "agent-only.lg");
    await session.mark_loaded(project_path);
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      create_database([], {
        "data.generic": { content: Buffer.alloc(0), file_type: "GENERIC" },
        "video.media": { content: Buffer.alloc(0), file_type: "MEDIA" },
        "book.image": { content: Buffer.alloc(0), file_type: "IMAGE" },
      }),
      create_setting_service(),
      session,
      async () => {},
    );
    for (const generate of [
      () => service.generate_files({ project_path, expected_section_revisions: { files: 0 } }),
      () => service.generate_files_to_directory(path.join(temp_dir, "cli")),
    ])
      await expect(generate()).rejects.toMatchObject({
        code: "project.no_files",
        public_details: {
          reason: "no_generatable_files",
          excluded_files: ["data.generic", "video.media", "book.image"],
        },
      });
    expect(fs.readdirSync(temp_dir)).toEqual([]);
  });

  it("生成持有工程独占范围，Agent 暂存生成必须归属当前回合", async () => {
    const gate = new RuntimeOperationGate();
    const session = new ProjectSessionState();
    const project_path = path.join(temp_dir, "locked.lg");
    await session.mark_loaded(project_path);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const database = create_database([
      { file_path: "a.txt", file_type: "TXT", src: "source", dst: "target", status: "PROCESSED" },
    ]);
    const items = database.get_all_items.bind(database);
    vi.spyOn(database, "get_all_items").mockImplementationOnce(async (project) => {
      entered.resolve();
      await release.promise;
      return items(project);
    });
    const service = new TranslationFileGenerationService(
      gate,
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service(),
      session,
      async () => {},
    );
    const pending = service.generate_files({
      project_path,
      expected_section_revisions: { files: 0 },
    });
    try {
      await entered.promise;
      expect(() => gate.begin_runtime("agent")).toThrow(
        expect.objectContaining({ code: "runtime.busy" }),
      );
      await expect(gate.run_project_write(() => {})).rejects.toMatchObject({
        code: "runtime.busy",
      });
    } finally {
      release.resolve();
      await pending;
    }
    await expect(
      service.generate_staging_files(path.join(temp_dir, "staging")),
    ).rejects.toMatchObject({ code: "runtime.busy" });
    const lease = gate.begin_runtime("agent");
    try {
      await expect(
        service.generate_staging_files(path.join(temp_dir, "staging")),
      ).resolves.toMatchObject({ accepted: true, excluded_files: [] });
    } finally {
      gate.finish_runtime(lease);
    }
  });

  it("空工程在 GUI、CLI 和 Agent 生成时拒绝且不创建目录", async () => {
    const session = new ProjectSessionState();
    const project_path = path.join(temp_dir, "empty.lg");
    await session.mark_loaded(project_path);
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      create_database([]),
      create_setting_service(),
      session,
      async () => {},
    );
    for (const generate of [
      () => service.generate_files({ expected_section_revisions: { files: 0 }, project_path }),
      () => service.generate_files_to_directory(path.join(temp_dir, "cli")),
      () => service.generate_staging_files(path.join(temp_dir, "agent")),
    ])
      await expect(generate()).rejects.toMatchObject({ code: "project.no_files" });
    expect(fs.readdirSync(temp_dir)).toEqual([]);
  });

  it("Agent 暂存生成自动为原生双语格式输出双语，仅单语资产时不创建双语目录", async () => {
    const book = await create_epub_fixture("书籍正文");
    const book_items = await new EPUBFormat({ target_language: "ZH" }).read_from_stream(
      book,
      "book.epub",
    );
    const assets = {
      "novel.txt": { content: Buffer.from("小说"), file_type: "TXT" },
      "book.epub": { content: book, file_type: "EPUB" },
      "movie.srt": {
        content: Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nHello\n"),
        file_type: "SRT",
      },
      "notes.md": { content: Buffer.from("# Title\n"), file_type: "MD_V2" },
    };
    const items = [
      ...book_items,
      create_item({
        file_path: "novel.txt",
        file_type: "TXT",
        src: "原文",
        dst: "译文",
        status: "PROCESSED",
      }),
      create_item({
        file_path: "notes.md",
        file_type: "MD_V2",
        src: "Title",
        dst: "标题",
        status: "PROCESSED",
      }),
    ];
    const session = new ProjectSessionState();
    await session.mark_loaded(path.join(temp_dir, "mixed.lg"));
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      create_database(items, assets),
      create_setting_service(),
      session,
      async () => {},
    );
    const mixed = await service.generate_staging_files(path.join(temp_dir, "agent-mixed"));
    expect(fs.readdirSync(mixed.output_path).sort()).toEqual(Object.keys(assets).sort());
    expect(fs.readdirSync(mixed.bilingual_output_path).sort()).toEqual([
      "book.epub",
      "movie.srt",
      "novel.txt",
    ]);

    const mono_service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      create_database(
        [
          create_item({
            file_path: "notes.md",
            file_type: "MD_V2",
            src: "Title",
            dst: "标题",
            status: "PROCESSED",
          }),
        ],
        { "notes.md": assets["notes.md"] },
      ),
      create_setting_service(),
      session,
      async () => {},
    );
    const mono = await mono_service.generate_staging_files(path.join(temp_dir, "agent-mono"));
    expect(fs.readdirSync(mono.output_path)).toEqual(["notes.md"]);
    expect(fs.existsSync(mono.bilingual_output_path)).toBe(false);
  });

  it("普通生成报告排除的通用与视频资产，暂存生成隔离写回输入", async () => {
    const project_path = path.join(temp_dir, "mixed.lg");
    const records = [{ message: "こんにちは", locator: { offset: 2 } }];
    const content = Buffer.from(
      await write_zip(
        new Map([
          ["items.json", JSON.stringify(records)],
          ["tools/run.mjs", "throw new Error('must not execute')"],
        ]),
      ),
    );
    const media_records = [{ ...records[0], start: 0, end: 2, kind: "dialogue" }];
    const media_content = Buffer.from(
      await write_zip(
        new Map([
          [
            "media.json",
            JSON.stringify({
              source: {
                path: "C:/media/movie.mp4",
                size: 1,
                mtime_ns: "1",
                track: 0,
                language: "JA",
              },
              duration: 2,
              video: { width: 1920, height: 1080 },
              speech: null,
              asr: null,
              text: [],
            }),
          ],
          ["items.json", JSON.stringify(media_records)],
        ]),
      ),
    );
    const items = await new GenericFormat().read_from_stream(content, "data.generic");
    items[0] = { ...items[0]!, status: "PROCESSED", dst: "你好" };
    const session = new ProjectSessionState();
    await session.mark_loaded(project_path);
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      create_database(
        [
          ...items,
          create_item({ ...items[0]!, file_path: "movie.media", file_type: "MEDIA" }),
          create_item({
            file_path: "native.txt",
            file_type: "TXT",
            src: "原文",
            dst: "译文",
            status: "PROCESSED",
          }),
        ],
        {
          "data.generic": { content, file_type: "GENERIC" },
          "movie.media": { content: media_content, file_type: "MEDIA" },
          "empty.generic": {
            content: Buffer.from(await write_zip(new Map([["items.json", "[]"]]))),
            file_type: "GENERIC",
          },
          "native.txt": { content: Buffer.from("原文"), file_type: "TXT" },
        },
      ),
      create_setting_service(),
      session,
      async () => {},
    );
    const gui = await service.generate_files({
      expected_section_revisions: { files: 0 },
      project_path,
      output_directory: temp_dir,
    });
    expect(fs.readFileSync(path.join(gui.output_path, "native.txt"), "utf8")).toBe("译文");
    expect(fs.existsSync(path.join(gui.output_path, "data.generic"))).toBe(false);
    expect(fs.existsSync(path.join(gui.output_path, "empty.generic"))).toBe(false);
    expect(gui.excluded_files).toEqual(["data.generic", "movie.media", "empty.generic"]);
    const generated = await service.generate_staging_files(path.join(temp_dir, "agent"));
    expect(generated.excluded_files).toEqual([]);
    expect(generated.writeback!.files).toEqual(gui.excluded_files);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(generated.writeback!.input_path, "movie.media/items.json"),
          "utf8",
        ),
      ),
    ).toEqual([{ ...media_records[0], message: "你好" }]);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(generated.writeback!.input_path, "data.generic/items.json"),
          "utf8",
        ),
      ),
    ).toEqual([{ ...records[0], message: "你好" }]);
    expect(
      fs.readFileSync(
        path.join(generated.writeback!.input_path, "empty.generic/items.json"),
        "utf8",
      ),
    ).toBe("[]");
    expect(fs.readdirSync(path.join(generated.writeback!.input_path, "data.generic"))).toEqual([
      "items.json",
    ]);
    const staging_paths = [
      generated.output_path,
      generated.bilingual_output_path,
      generated.writeback!.input_path,
    ];
    expect(new Set(staging_paths).size).toBe(3);
    expect(new Set(staging_paths.map((directory) => path.dirname(directory)))).toEqual(
      new Set([path.join(temp_dir, "agent")]),
    );
    expect(fs.existsSync(path.join(generated.output_path, "data.generic"))).toBe(false);
    expect(fs.existsSync(path.join(generated.bilingual_output_path, "data.generic"))).toBe(false);
    const cli = await service.generate_files_to_directory(path.join(temp_dir, "cli"));
    expect(cli.excluded_files).toEqual(gui.excluded_files);
    expect(fs.readdirSync(cli.output_path).sort()).toEqual(["bilingual", "native.txt"]);
    expect(fs.readFileSync(path.join(generated.output_path, "native.txt"), "utf8")).toBe("译文");
  });

  it("GUI 校验请求后在指定父目录生成，并避开两个目录的重名", async () => {
    const project_path = path.join(temp_dir, "demo.lg");
    const output_directory = path.join(temp_dir, "destination");
    fs.mkdirSync(output_directory);
    fs.writeFileSync(project_path, "project");
    const session = new ProjectSessionState();
    session.mark_loaded(project_path);
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
    const read = vi.spyOn(database, "get_all_meta");
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service(),
      session,
      async () => {},
    );
    const text = create_text_resolver("zh-CN");
    fs.mkdirSync(
      path.join(output_directory, `demo_${text("app.translation_export.directory.bilingual")}`),
    );
    for (const request of [
      {},
      { project_path: "other", output_directory },
      { project_path, expected_section_revisions: { files: 0 }, output_directory: "relative" },
      {
        project_path,
        expected_section_revisions: { files: 0 },
        output_directory: path.join(temp_dir, "missing"),
      },
      { project_path, expected_section_revisions: { files: 0 }, output_directory: project_path },
    ]) {
      await expect(service.generate_files(request)).rejects.toMatchObject({
        code: "translation.generation_failed",
      });
    }
    expect(read).not.toHaveBeenCalled();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5));
      const first = await service.generate_files({
        expected_section_revisions: { files: 0 },
        project_path,
        output_directory,
      });
      const second = await service.generate_files({
        expected_section_revisions: { files: 0 },
        project_path,
        output_directory,
      });
      const third = await service.generate_files({
        expected_section_revisions: { files: 0 },
        project_path,
        output_directory,
      });
      expect(new Set([first.output_path, second.output_path, third.output_path]).size).toBe(3);
      expect(path.basename(first.output_path)).not.toBe(
        `demo_${text("app.translation_export.directory.translated")}`,
      );
      for (const result of [first, second, third]) {
        expect(path.dirname(result.output_path)).toBe(output_directory);
        expect(fs.readFileSync(path.join(result.output_path, "script.txt"), "utf8")).toBe("译文");
      }
    } finally {
      vi.useRealTimers();
    }
  });
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
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      create_database(items, {
        "old/sub.txt": {
          content: Buffer.from(`[Events]\n${fields}\n${prefix}原文\n`),
          file_type: "ASS",
        },
        "old/sub.srt": { content: Buffer.from(`7\n${time}\n原文\n\n`), file_type: "SRT" },
      }),
      create_setting_service(),
      session,
      async () => {},
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

  it("导出零条目字幕", async () => {
    const assets = {
      "empty.vtt": { content: Buffer.from("WEBVTT\n\nNOTE structure\n"), file_type: "VTT" },
      "empty.lrc": { content: Buffer.from("[offset:50]\n[00:01]\n"), file_type: "LRC" },
      "empty.ssa": { content: Buffer.from("[Events]\n"), file_type: "ASS" },
    };
    const session = new ProjectSessionState();
    session.mark_loaded(path.join(temp_dir, "empty.lg"));
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      create_database([], assets),
      create_setting_service(),
      session,
      async () => {},
    );
    const result = await service.generate_files_to_directory(path.join(temp_dir, "out"));
    for (const [file, { content }] of Object.entries(assets)) {
      expect(fs.readFileSync(path.join(result.output_path, file)).equals(content)).toBe(true);
    }
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
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service(),
      session_state,
      output_folder_opener,
    );

    const result = await service.generate_files({
      expected_section_revisions: { files: 0 },
      project_path: session_state.require_loaded_project_path(),
      output_directory: temp_dir,
    });
    expect(fs.readFileSync(path.join(String(result.output_path), "script.txt"), "utf-8")).toBe(
      `${dst}\n${dst}`,
    );
    expect(output_folder_opener).not.toHaveBeenCalled();
  });

  it("游戏导出保留输出目录中已安装的补丁", async () => {
    const output = path.join(temp_dir, "output");
    const patch = path.join(output, "game/custom/a.json");
    fs.mkdirSync(path.dirname(patch), { recursive: true });
    fs.writeFileSync(patch, "installed patch");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(path.join(temp_dir, "game.lg"));
    const content = Buffer.from(await write_zip(new Map([["data/System.json", "{}"]])));
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      create_database([], { "game.zip": { content, file_type: "RPGMAKER_MV_MZ" } }, {}),
      create_setting_service(),
      session_state,
      async () => {},
    );
    await service.generate_files_to_directory(output);
    expect(fs.readFileSync(patch, "utf8")).toBe("installed patch");
  });

  it("译文生成使用项目目标语言，不读取应用设置中的语言", async () => {
    const project_path = path.join(temp_dir, "language.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const content = Buffer.from("WEBVTT\n\n00:00.000 --> 00:02.000\n<lang ja>こんにちは</lang>\n");
    const parsed = await new FileFormatService(new GameDirectoryOperations(), {
      target_language: "ZH",
    }).parse_asset("sub.vtt", content, "VTT");
    const database = create_database(
      parsed.items.map((item, index) => ({
        ...item,
        id: index + 1,
        dst: "Hello",
        status: "PROCESSED",
      })) as unknown as Array<Record<string, unknown>>,
      { "sub.vtt": { content, file_type: "VTT" } },
      { target_language: "EN" },
    );
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service(),
      session_state,
      vi.fn<OutputFolderOpener>(),
    );

    const result = await service.generate_files({
      expected_section_revisions: { files: 0 },
      project_path: session_state.require_loaded_project_path(),
      output_directory: temp_dir,
    });
    expect(fs.readFileSync(path.join(String(result.output_path), "sub.vtt"), "utf-8")).toContain(
      "<lang en>Hello</lang>",
    );
  });

  it("MESSAGEJSON 译文生成只在相同姓名间复用译文", async () => {
    const project_path = path.join(temp_dir, "actors.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const database = create_database(
      [
        {
          id: 1,
          src: "あうぅ……。",
          dst: "嗷呜……。",
          name_src: "アビゲイル",
          name_dst: "阿比盖尔",
          status: "PROCESSED",
          file_type: "MESSAGEJSON",
          file_path: "actors.json",
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
          row: 2,
        },
      ],
      {
        "actors.json": {
          file_type: "MESSAGEJSON",
          content: Buffer.from(
            JSON.stringify([
              { name: "アビゲイル", message: "あうぅ……。" },
              { name: "アビゲイル", message: "あうぅ……。" },
              { name: "武藏", message: "あうぅ……。" },
            ]),
          ),
        },
      },
    );
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service(),
      session_state,
      vi.fn<OutputFolderOpener>(),
    );

    const result = await service.generate_files({
      expected_section_revisions: { files: 0 },
      project_path: session_state.require_loaded_project_path(),
      output_directory: temp_dir,
    });

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
      { "readme.md": { content: Buffer.from(source), file_type: "MD_V2" } },
    );
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service(),
      session_state,
      vi.fn<OutputFolderOpener>(),
    );

    const result = await service.generate_files({
      expected_section_revisions: { files: 0 },
      project_path: session_state.require_loaded_project_path(),
      output_directory: temp_dir,
    });

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
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service({ app_language: "DE" }),
      session_state,
      vi.fn<OutputFolderOpener>(),
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

    await expect(
      service.generate_files({
        expected_section_revisions: { files: 0 },
        project_path: session_state.require_loaded_project_path(),
        output_directory: temp_dir,
      }),
    ).resolves.toEqual({
      accepted: true,
      excluded_files: [],
      output_path: translated_path,
      bilingual_output_path: bilingual_path,
    });

    expect(fs.readFileSync(path.join(translated_path, "script.txt"), "utf-8")).toBe("Übersetzung");
    expect(fs.existsSync(path.join(bilingual_path, "script.txt"))).toBe(true);
    expect(log_collector.info).toHaveBeenNthCalledWith(
      2,
      `${text("app.translation_export.log.succeeded")}\n${translated_path}`,
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
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service({ output_folder_open_on_finish: true }),
      session_state,
      output_folder_opener,
    );

    const result = await service.generate_files({
      expected_section_revisions: { files: 0 },
      project_path: session_state.require_loaded_project_path(),
      output_directory: temp_dir,
    });
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
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service({ output_folder_open_on_finish: true }),
      session_state,
      output_folder_opener,
    );

    await expect(service.generate_files_to_directory(output_dir)).resolves.toEqual({
      accepted: true,
      excluded_files: [],
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
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service({ output_folder_open_on_finish: true }),
      session_state,
      output_folder_opener,
      log_collector,
    );

    await expect(
      service.generate_files({
        expected_section_revisions: { files: 0 },
        project_path: session_state.require_loaded_project_path(),
        output_directory: temp_dir,
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(log_collector.error).toHaveBeenCalledExactlyOnceWith(
      create_text_resolver("zh-CN")("app.translation_export.log.open_output_folder_failed"),
      { source: "translation-generation", error },
    );
  });

  it.each(["gui-write", "directory-prepare"] as const)(
    "%s 失败时统一报告译文生成错误并保留一份原始诊断",
    async (entry) => {
      const project_path = path.join(temp_dir, "demo.lg");
      const session_state = new ProjectSessionState();
      session_state.mark_loaded(project_path);
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
        {
          "script.txt": { content: Buffer.from("原文"), file_type: "TXT" },
        },
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
      const service = new TranslationFileGenerationService(
        create_generation_gate(),
        { check_section_revisions: async () => {} },
        new GameDirectoryOperations(),
        database,
        create_setting_service({ output_folder_open_on_finish: true }),
        session_state,
        vi.fn<OutputFolderOpener>(),
        log_collector,
      );

      const result =
        entry === "gui-write"
          ? service.generate_files({
              expected_section_revisions: { files: 0 },
              project_path: session_state.require_loaded_project_path(),
              output_directory: temp_dir,
            })
          : service.generate_staging_files(path.join(temp_dir, "out"));
      await expect(result).rejects.toMatchObject({
        code: "translation.generation_failed",
        cause: error,
      });

      const text = create_text_resolver("zh-CN");
      expect(log_collector.error).toHaveBeenCalledExactlyOnceWith(
        {
          kind: "text",
          text: `${text("app.translation_export.log.failed")}\n${error.message}`,
        },
        { source: "translation-generation", error },
      );
      expect(log_collector.info).toHaveBeenCalledExactlyOnceWith(
        text("app.translation_export.log.started"),
        { source: "translation-generation", console_group_end: false },
      );
      if (entry === "directory-prepare") expect(write_file).not.toHaveBeenCalled();
    },
  );

  it("已有业务错误保留原始错误码和详情", async () => {
    const session = new ProjectSessionState();
    session.mark_loaded(path.join(temp_dir, "project.lg"));
    const database = create_database([], {
      "book.epub": { content: Buffer.alloc(0), file_type: "EPUB" },
    });
    const error = new AppError("file.invalid_structure", { public_details: { file: "book.epub" } });
    vi.spyOn(database, "get_all_items").mockImplementation(() => {
      throw error;
    });
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      database,
      create_setting_service(),
      session,
      async () => {},
    );
    await expect(
      service.generate_files({
        expected_section_revisions: { files: 0 },
        project_path: session.require_loaded_project_path(),
        output_directory: temp_dir,
      }),
    ).rejects.toBe(error);
  });
});

it.each(["PROJECT", "FIXED", "MANUAL"] as const)(
  "%s 设置由 GUI 和 Agent 共用，显式目录优先且路径查询不创建目录",
  async (mode) => {
    const project_path = path.join(temp_dir, "project.lg");
    const fixed = path.join(temp_dir, "fixed");
    const chosen = path.join(temp_dir, "chosen");
    fs.mkdirSync(fixed);
    fs.mkdirSync(chosen);
    const session = new ProjectSessionState();
    session.mark_loaded(project_path);
    const service = new TranslationFileGenerationService(
      create_generation_gate(),
      { check_section_revisions: async () => {} },
      new GameDirectoryOperations(),
      create_database([], { "empty.txt": { content: Buffer.alloc(0), file_type: "TXT" } }),
      create_setting_service({ translation_save_mode: mode, translation_fixed_path: fixed }),
      session,
      async () => {},
    );
    const paths = service.read_output_paths();
    expect(paths.manual).toBe(mode === "MANUAL");
    expect(path.dirname(paths.translated_path)).toBe(mode === "FIXED" ? fixed : temp_dir);
    expect(path.dirname(paths.bilingual_path)).toBe(path.dirname(paths.translated_path));
    expect(fs.existsSync(paths.translated_path)).toBe(false);
    expect(fs.existsSync(paths.bilingual_path)).toBe(false);
    const generated = await service.generate_files({
      expected_section_revisions: { files: 0 },
      project_path,
    });
    expect(generated.output_path).toBe(paths.translated_path);
    expect(generated.bilingual_output_path).toBe(paths.bilingual_path);
    const selected = service.read_output_paths(chosen);
    expect(selected.manual).toBe(false);
    expect(path.dirname(selected.translated_path)).toBe(chosen);
    const manual = await service.generate_files({
      expected_section_revisions: { files: 0 },
      project_path,
      output_directory: chosen,
    });
    expect(manual.output_path).toBe(selected.translated_path);
    expect(manual.bilingual_output_path).toBe(selected.bilingual_path);
  },
);

/** 格式用例在真实互斥内执行；Agent 入口由夹具提供所属回合。 */
function create_generation_gate() {
  const gate = new RuntimeOperationGate();
  return {
    run_project_write: gate.run_project_write.bind(gate),
    run_agent_project_write: async <T>(operation: (signal: AbortSignal) => T | Promise<T>) => {
      const lease = gate.begin_runtime("agent");
      try {
        return await gate.run_agent_project_write(operation);
      } finally {
        gate.finish_runtime(lease);
      }
    },
  };
}

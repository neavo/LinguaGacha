import { add_test_asset_from_source } from "../../test/asset-fixture";
import { CacheManager } from "../cache/cache-manager";
import type { AppSettingService } from "../app/app-setting-service";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import { ProjectSummaryService } from "./project-summary-service";
import { read_zip_fixture, write_zip } from "../../test/zip-fixture";
import { write_epub_fixture } from "../../test/epub-fixture";
import {
  create_workbench_import_files_plan,
  create_workbench_reset_file_plan,
  create_workbench_reorder_plan,
  create_workbench_delete_files_plan,
  type WorkbenchFileParsePreview,
} from "../../shared/workbench/workbench-command-planner";
import { create_pdf_execution, create_pdf_fixture } from "../file/pdf/test-support";

import { ProjectDataReader } from "./project-data-reader";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase, ProjectDatabaseAccess } from "../database/database-operations";
import { read_json_record, type JsonRecord, type JsonValue } from "../../domain/json";
import { FileFormatService } from "../file/file-format-service";
import type { LogManager } from "../log/log-manager";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectContentService } from "./project-content-service";
import { adapt_project_change, type ProjectChangePublisher } from "./project-write-event-adapter";
import { ProjectWriteStore } from "./project-write-store";

import { ProjectSessionState } from "./project-session-state";

let temp_dir = "";

/**
 * 所有临时工程路径都落在本用例目录下，避免误碰用户项目文件
 */
function project_path(name: string): string {
  return path.join(temp_dir, name);
}

/** 从真实数据库读取设置或统计，供持久化结果断言使用。 */
async function read_meta(
  database: ProjectDatabase,
  project_path: string,
  key: string,
  default_value: JsonValue,
): Promise<JsonValue> {
  return ((await database.get_all_meta(project_path)) as JsonRecord)[key] ?? default_value;
}

/**
 * 为每个用例创建独立 .lg 和服务实例，避免 revision / asset 顺序互相污染
 */
async function create_service(
  project_change_publisher?: ProjectChangePublisher | null,
  log_manager: Pick<LogManager, "warning"> | null = create_log_manager(),
): Promise<{
  database: ProjectDatabase;
  service: ProjectContentService;
  runtime_gate: RuntimeOperationGate;
  session_state: ProjectSessionState;
  lg_path: string;
}> {
  const database = new ProjectDatabase();
  const session_state = new ProjectSessionState();
  const lg_path = project_path("demo.lg");
  await database.create_project(lg_path, "demo");
  session_state.mark_loaded(lg_path);
  const publisher =
    project_change_publisher === undefined
      ? create_test_project_change_publisher().publish_project_change
      : project_change_publisher;
  const runtime_gate = new RuntimeOperationGate();
  const project_event_bus = vi.fn();
  const write_store = new ProjectWriteStore(database, project_event_bus, publisher);
  return {
    database,
    service: new ProjectContentService(
      database,
      runtime_gate,
      session_state,
      write_store,
      create_pdf_execution(),
      null,
      undefined,
      log_manager,
    ),
    runtime_gate,
    session_state,
    lg_path,
  };
}

/** 收集解析警告供断言，避免测试写入真实日志。 */
function create_log_manager(): Pick<LogManager, "warning"> {
  return {
    warning: vi.fn(),
  };
}

/** 使用真实事件适配器，修订与载荷取自本次提交。 */
function create_test_project_change_publisher() {
  const session = new ProjectSessionState();
  void session.mark_loaded(project_path("demo.lg"));
  return {
    publish_project_change: vi.fn((payload: Parameters<typeof adapt_project_change>[1]) =>
      adapt_project_change(session, payload),
    ),
  };
}

/** 补齐公开条目默认字段，用例只声明影响当前行为的差异。 */
function create_public_item(overrides: JsonRecord = {}): JsonRecord {
  return {
    item_id: 1,
    src: "原文",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 1,
    file_type: "TXT",
    file_path: "a.txt",
    status: "NONE",
    skip_internal_filter: false,
    ...overrides,
  };
}

/** 从同一份默认条目转换数据库字段，避免维护两套测试数据。 */
function create_persistent_item(overrides: JsonRecord = {}): JsonRecord {
  const item = create_public_item(overrides);
  const { item_id, row_number, ...rest_item } = item;
  return {
    ...rest_item,
    id: item_id!,
    row: row_number!,
  };
}

/**
 * 暂停下一次格式解析，稳定复现慢准备阶段持有结构性写入租约的窗口
 */
function pause_next_parse_asset(): {
  parse_started: Promise<void>;
  release_parse: () => void;
} {
  const original_parse_asset = FileFormatService.prototype.parse_asset;
  let mark_parse_started: () => void = () => {};
  let release_parse: () => void = () => {};
  const parse_started = new Promise<void>((resolve) => {
    mark_parse_started = resolve;
  });
  const parse_released = new Promise<void>((resolve) => {
    release_parse = resolve;
  });
  vi.spyOn(FileFormatService.prototype, "parse_asset").mockImplementationOnce(async function (
    this: FileFormatService,
    rel_path,
    content,
  ) {
    mark_parse_started();
    await parse_released;
    return original_parse_asset.call(this, rel_path, content);
  });
  return { parse_started, release_parse };
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-project-service-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectContentService", () => {
  it("TRANS 替换按引擎身份继承译文，变更或移除引擎后重新匹配", async () => {
    const { database, service, lg_path } = await create_service();
    const source = project_path("game.trans");
    try {
      for (const [engine, expected_translation] of [
        ["kag", ""],
        ["kag", "译文"],
        ["wolf", ""],
        [undefined, ""],
      ] as const) {
        fs.writeFileSync(
          source,
          JSON.stringify({
            project: {
              gameEngine: engine,
              files: { chapter: { data: [["こんにちは", ""]] } },
            },
          }),
        );
        await service.import_files({
          files: [{ source_path: source, target_rel_path: "game.trans" }],
          conflict_action: "replace",
          inheritance_mode: "inherit",
          project_settings: { source_language: "JA", target_language: "ZH" },
          expected_section_revisions: await database.read(lg_path, (access) =>
            new ProjectDataReader(access).build_section_revisions(access.get_all_meta(lg_path)),
          ),
        });
        expect(
          (
            await database.read(lg_path, (access) =>
              new ProjectDataReader(access).build_files_record_block(lg_path),
            )
          )["game.trans"],
        ).toMatchObject({
          file_type: "TRANS",
          game_engine: engine ?? "",
        });
        const items = await database.get_all_items(lg_path);
        expect(items).toMatchObject([
          { dst: expected_translation, status: expected_translation === "" ? "NONE" : "PROCESSED" },
        ]);
        // 下一次替换仍有已完成候选，确保引擎变化真正参与继承匹配。
        await database.transaction(lg_path, (writer) =>
          writer.set_items(
            lg_path,
            items.map((item) => ({ ...item, dst: "译文", status: "PROCESSED" })),
          ),
        );
      }
    } finally {
      await database.close();
    }
  });

  it("同批同名游戏只分配一次，已有 game_2 保持不变且提交沿用预览名称", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 11, 12, 34, 56));
    const { database, service, lg_path } = await create_service();
    try {
      const old = await write_zip(new Map([["data/System.json", "{}"]]));
      await database.transaction(lg_path, (writer) =>
        writer.add_asset(lg_path, "game_2.zip", old, "RPGMAKER_MV_MZ", null),
      );
      const roots = [project_path("a/game"), project_path("b/game")];
      for (const root of roots) {
        fs.mkdirSync(path.join(root, "data"), { recursive: true });
        fs.mkdirSync(path.join(root, "js"), { recursive: true });
        fs.writeFileSync(path.join(root, "data/System.json"), "{}");
        fs.writeFileSync(path.join(root, "js/rmmz_core.js"), "");
      }
      const preview = await service.parse_project_file({ source_paths: roots });
      const files = preview["files"] as JsonRecord[];
      expect(files.map((file) => file["target_rel_path"])).toEqual([
        "game.zip",
        "game_20261011_123456.zip",
      ]);
      vi.setSystemTime(new Date(2026, 9, 11, 12, 35, 0));
      await service.import_files({
        files: files.map((file) => ({
          source_path: file["source_path"]!,
          target_rel_path: file["target_rel_path"]!,
        })),
        conflict_action: "replace",
        expected_section_revisions: { files: 0, items: 0 },
      });
      expect((await database.get_all_asset_records(lg_path)).map((asset) => asset.path)).toEqual([
        "game_2.zip",
        "game.zip",
        "game_20261011_123456.zip",
      ]);
      expect(await database.read_asset_content(lg_path, "game_2.zip")).toEqual(old);
      const replacement = await service.parse_project_file({ source_paths: [roots[0]!] });
      expect(replacement["files"]).toMatchObject([{ target_rel_path: "game.zip" }]);
    } finally {
      await database.close();
      vi.useRealTimers();
    }
  });
  it.each(["game-first", "file-first", "mixed"])(
    "追加预览名称与提交身份一致：%s",
    async (order) => {
      const { database, service, lg_path } = await create_service();
      const game = project_path("a/game");
      const ordinary = project_path("b/game");
      fs.mkdirSync(path.join(game, "data"), { recursive: true });
      fs.mkdirSync(path.join(game, "js"), { recursive: true });
      fs.mkdirSync(ordinary, { recursive: true });
      fs.writeFileSync(path.join(game, "data/System.json"), "{}");
      fs.writeFileSync(path.join(game, "js/rmmz_core.js"), "");
      fs.writeFileSync(path.join(ordinary, "readme.txt"), "说明");
      const batches =
        order === "mixed"
          ? [[game, ordinary]]
          : order === "game-first"
            ? [[game], [ordinary]]
            : [[ordinary], [game]];
      const prepared_paths: string[] = [];
      try {
        for (const source_paths of batches) {
          const preview = await service.parse_project_file({ source_paths });
          const files = preview["files"] as JsonRecord[];
          prepared_paths.push(...files.map((file) => String(file["target_rel_path"])));
          await service.import_files({
            files: files.map(({ source_path, target_rel_path }) => ({
              source_path: source_path!,
              target_rel_path: target_rel_path!,
            })),
            conflict_action: "replace",
            expected_section_revisions: await database.read(
              lg_path,
              (access) =>
                new ProjectDataReader(access).build_manifest({
                  loaded: true,
                  projectPath: lg_path,
                })["sectionRevisions"]!,
            ),
          });
        }
        const assets = await database.get_all_asset_records(lg_path);
        expect(assets.map((asset) => asset.path)).toEqual(prepared_paths);
        const regular = assets.find((asset) => asset.file_type === "TXT")!;
        expect((await database.read_asset_content(lg_path, regular.path))?.toString()).toBe("说明");
      } finally {
        await database.close();
      }
    },
  );

  it.each(["TXT", "RPGMAKER_MV_MZ"])(
    "正式导入拒绝绕过预览的祖先冲突，保留资产、条目与修订：%s",
    async (type) => {
      const { database, service, lg_path } = await create_service();
      try {
        const identity = type === "RPGMAKER_MV_MZ" ? "game.zip" : "game";
        await database.transaction(lg_path, (writer) =>
          writer.add_asset(lg_path, identity, Buffer.from("原稿"), type, null),
        );
        const source = project_path("readme.txt");
        fs.writeFileSync(source, "新文");
        const meta = await database.get_all_meta(lg_path);
        await expect(
          service.import_files({
            files: [{ source_path: source, target_rel_path: "game/readme.txt" }],
            conflict_action: "replace",
            expected_section_revisions: { files: 0, items: 0 },
          }),
        ).rejects.toMatchObject({ code: "request.validation_failed" });
        expect((await database.get_all_asset_records(lg_path)).map((asset) => asset.path)).toEqual([
          identity,
        ]);
        expect((await database.read_asset_content(lg_path, identity))?.toString()).toBe("原稿");
        expect(await database.get_all_items(lg_path)).toEqual([]);
        expect(await database.get_all_meta(lg_path)).toEqual(meta);
      } finally {
        await database.close();
      }
    },
  );
  it("项目文件预解析忽略不支持后缀并返回支持格式的失败文件", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-file-preview-"));
    const source_file = path.join(temp_dir.path, "script.txt");
    const broken_json = path.join(temp_dir.path, "broken.json");
    const ignored_file = path.join(temp_dir.path, "ignore.bin");
    fs.writeFileSync(source_file, "原文", "utf-8");
    fs.writeFileSync(broken_json, "{", "utf-8");
    fs.writeFileSync(ignored_file, "noise", "utf-8");
    const log_manager = create_log_manager();
    const { database, service } = await create_service(undefined, log_manager);
    try {
      await expect(
        service.parse_project_file({
          source_paths: [source_file, broken_json, ignored_file],
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
            source_path: broken_json,
            rel_path: "broken.json",
            filename: "broken.json",
            code: "file.parse_failed",
            message: expect.any(String),
          },
        ],
      });
      expect(log_manager.warning).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ source: "project-import" }),
      );
    } finally {
      await database.close();
    }
  });

  it("项目文件预解析 EPUB 时直接返回解析结果", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-file-preview-"));
    const epub_file = path.join(temp_dir.path, "book.epub");
    await write_epub_fixture(epub_file, "章节");
    const { database, service } = await create_service();
    try {
      await expect(
        service.parse_project_file({
          source_paths: [epub_file],
        }),
      ).resolves.toEqual({
        files: [
          {
            source_path: epub_file,
            target_rel_path: "book.epub",
            file_type: "EPUB",
            parsed_items: [
              expect.objectContaining({
                src: "章节",
                file_type: "EPUB",
                file_path: "book.epub",
              }),
            ],
          },
        ],
        failed_files: [],
      });
    } finally {
      await database.close();
    }
  });

  it("项目文件预解析 EPUB 坏内容时返回文件解析错误码", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-file-preview-"));
    const epub_file = path.join(temp_dir.path, "broken.epub");
    const zip = new Map<string, string | Uint8Array>();
    zip.set(
      "META-INF/container.xml",
      `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
    );
    zip.set(
      "OPS/package.opf",
      `<package version="3.0">
        <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="chapter"/></spine>
      </package>`,
    );
    zip.set("OPS/chapter.xhtml", "");
    fs.writeFileSync(epub_file, await write_zip(zip));
    const { database, service } = await create_service();
    try {
      await expect(service.parse_project_file({ source_paths: [epub_file] })).resolves.toEqual({
        files: [],
        failed_files: [
          {
            source_path: epub_file,
            rel_path: "broken.epub",
            filename: "broken.epub",
            code: "file.parse_failed",
            message: expect.any(String),
          },
        ],
      });
    } finally {
      await database.close();
    }
  });

  it("游戏整体替换移除旧内部文件，失败回滚并支持离线重建和独立删除", async () => {
    const log_manager = create_log_manager();
    const { database, service, lg_path } = await create_service(undefined, log_manager);
    const source = project_path("game");
    const write = (file: string, content: string): void => {
      const target = path.join(source, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    };
    const revisions = () =>
      database.read(
        lg_path,
        (access) =>
          new ProjectDataReader(access).build_manifest({ loaded: true, projectPath: lg_path })
            .sectionRevisions!,
      );
    const request = async () => ({
      files: [{ source_path: source, target_rel_path: "game.zip" }],
      conflict_action: "replace",
      expected_section_revisions: await revisions(),
      project_settings: { source_language: "ALL", target_language: "ZH" },
    });
    try {
      write("data/System.json", "{}");
      write("js/rmmz_core.js", "");
      write("data/Old.json", '{"text":"旧文"}');
      await database.transaction(lg_path, (writer) =>
        writer.add_asset(lg_path, "other.txt", Buffer.from("保留"), "TXT", null),
      );
      await service.import_files(await request());
      const old = await database.read_asset_content(lg_path, "game.zip");
      const old_items = await database.get_all_items(lg_path);
      fs.rmSync(path.join(source, "data/Old.json"));
      write("data/New.json", '{"text":"新文"}');
      write("data/Broken.json", "{");
      write("js/plugins.js", 'const broken = "');
      const fail = vi
        .spyOn(ProjectDatabaseAccess.prototype, "set_items")
        .mockImplementationOnce(() => {
          throw new Error("write failure");
        });
      await expect(service.import_files(await request())).rejects.toThrow();
      fail.mockRestore();
      expect(await database.read_asset_content(lg_path, "game.zip")).toEqual(old);
      expect(await database.get_all_items(lg_path)).toEqual(old_items);
      await service.import_files(await request());
      const saved = (await database.read_asset_content(lg_path, "game.zip"))!;
      expect([...(await read_zip_fixture(saved)).keys()]).not.toContain("data/Old.json");
      expect(await database.get_all_items(lg_path)).toMatchObject([
        { src: "新文", file_path: "game.zip" },
      ]);
      expect(log_manager.warning).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          context: {
            warnings: expect.arrayContaining([
              expect.objectContaining({
                rel_path: "game.zip",
                internal_file_path: "data/Broken.json",
                code: "internal_file_parse_failed",
              }),
              expect.objectContaining({
                rel_path: "game.zip",
                internal_file_path: "js/plugins.js",
                code: "script_syntax_error",
              }),
            ]),
          },
        }),
      );
      fs.renameSync(source, source + "-moved");
      await service.reset_translation({ mode: "all" });
      expect((await database.get_all_items(lg_path)).some((item) => item.src === "新文")).toBe(
        true,
      );
      expect(await database.read_asset_content(lg_path, "game.zip")).toEqual(saved);
      await expect(
        service.import_files({
          ...(await request()),
          files: [
            {
              source_path: path.join(source + "-moved", "data/New.json"),
              target_rel_path: "game.zip",
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "file.parse_failed" });
      expect(await database.read_asset_content(lg_path, "game.zip")).toEqual(saved);
      await service.delete_files({
        rel_paths: ["game.zip"],
        expected_section_revisions: await revisions(),
      });
      expect((await database.get_all_asset_records(lg_path)).map((file) => file.path)).toEqual([
        "other.txt",
      ]);
    } finally {
      await database.close();
    }
  });
  it("正式提交重新读取预览之后的目标资产身份", async () => {
    const { database, service, lg_path } = await create_service();
    try {
      const file = "Actors.json";
      const source = project_path(file);
      fs.writeFileSync(source, '[null,{"name":"勇者"}]');
      await database.transaction(lg_path, (writer) =>
        writer.add_asset(lg_path, file, Buffer.from("{}"), "MESSAGEJSON", null),
      );
      const preview = await service.parse_project_file({ source_paths: [source] });
      expect(preview["files"]).toMatchObject([{ file_type: "MESSAGEJSON" }]);
      await database.transaction(lg_path, (writer) =>
        writer.set_asset_file_type(lg_path, file, "KVJSON"),
      );
      fs.writeFileSync(source, '{"key":"追加"}');
      await service.import_files({
        files: [{ source_path: source, target_rel_path: file, file_type: "MESSAGEJSON" }],
        conflict_action: "replace",
        expected_section_revisions: { files: 0, items: 0 },
      });
      expect(await database.get_all_asset_records(lg_path)).toMatchObject([
        { file_type: "KVJSON" },
      ]);
      expect(await database.get_all_items(lg_path)).toMatchObject([
        { src: "key", dst: "追加", file_type: "KVJSON" },
      ]);
    } finally {
      await database.close();
    }
  });
  it.each(["data/CommonEvents.json", "js/plugins.js", "www/js/plugins/nested/menu.js"])(
    "原生 RM 导入、文件重置和全部重置共用来源与用途规则：%s",
    async (file) => {
      const { database, service, lg_path } = await create_service();
      try {
        const json = file.endsWith(".json");
        const script = 'actor["管理キー"]; say("こんにちは", "EV001", "Hello", "こんにちは");';
        const bytes = Buffer.from(
          json
            ? JSON.stringify([
                null,
                {
                  name: "插件事件",
                  list: [
                    {
                      code: 355,
                      indent: 0,
                      parameters: [script],
                    },
                  ],
                },
              ])
            : script,
        );
        const expected = [
          ...(json ? [["插件事件", "RULE_SKIPPED", ""]] : []),
          ["管理キー", "RULE_SKIPPED", ""],
          ["こんにちは", "RULE_SKIPPED", ""],
          ["EV001", "RULE_SKIPPED", ""],
          ["Hello", "RULE_SKIPPED", ""],
          ["こんにちは", "RULE_SKIPPED", ""],
        ];
        const source = project_path("game");
        const prefix = file.startsWith("www/") ? "www/" : "";
        for (const [internal, content] of [
          [prefix + "data/System.json", "{}"],
          [prefix + "js/rmmz_core.js", ""],
          [file, bytes],
        ] as const) {
          const target = path.join(source, internal);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content);
        }
        const project_settings = {
          source_language: "JA",
          target_language: "ZH",
          skip_duplicate_source_text_enable: true,
        };
        await service.import_files({
          files: [{ source_path: source, target_rel_path: "game.zip" }],
          conflict_action: "replace",
          expected_section_revisions: { files: 0, items: 0 },
          project_settings,
        });
        expect(
          (await database.get_all_items(lg_path)).map((item) => [
            item["src"],
            item["status"],
            item["dst"],
          ]),
        ).toEqual(expected);
        await database.transaction(lg_path, (writer) =>
          writer.set_items(
            lg_path,
            writer.get_all_items(lg_path).map((item) => {
              const extra_field = read_json_record(item["extra_field"]);
              // 代码来源优先于保存用途，文件重置与全部重建应恢复相同资格。
              if (item["src"] === "管理キー")
                extra_field["rpgmaker_mv_mz"] = {
                  ...read_json_record(extra_field["rpgmaker_mv_mz"]),
                  usage: "text",
                };
              return { ...item, extra_field, status: "PROCESSED", dst: "已翻译" };
            }),
          ),
        );
        await service.reset_files({
          rel_paths: ["game.zip"],
          expected_section_revisions: { files: 1, items: 1 },
          project_settings,
        });
        expect(
          (await database.get_all_items(lg_path)).map((item) => [
            item["src"],
            item["status"],
            item["dst"],
          ]),
        ).toEqual(expected);
        await service.reset_translation({ mode: "all", project_settings });
        expect(
          (await database.get_all_items(lg_path)).map((item) => [
            item["src"],
            item["status"],
            item["dst"],
          ]),
        ).toEqual(expected);
      } finally {
        await database.close();
      }
    },
  );

  it("失败重置保留 RM 脚本与人工启用元数据的翻译资格", async () => {
    const { database, service, lg_path } = await create_service();
    try {
      await database.transaction(lg_path, (writer) =>
        writer.add_asset(lg_path, "data/Actors.json", Buffer.from("[]"), "RPGMAKER_MV_MZ", null),
      );
      const items = [
        { usage: "text", status: "ERROR" },
        { usage: "metadata", status: "ERROR" },
        { usage: "metadata", status: "PROCESSED" },
        { usage: "metadata", status: "EXCLUDED" },
        { usage: "metadata", status: "RULE_SKIPPED" },
      ].map(({ usage, status }, index) =>
        create_persistent_item({
          item_id: index + 1,
          src: "EV001",
          dst: "已有译文",
          name_dst: "已有姓名",
          file_type: "RPGMAKER_MV_MZ",
          file_path: "data/Actors.json",
          status,
          extra_field: {
            rpgmaker_mv_mz: { usage },
          },
        }),
      );
      await database.transaction(lg_path, (writer) => writer.set_items(lg_path, items));
      await service.reset_translation({ mode: "failed" });
      expect(await database.get_all_items(lg_path)).toEqual([
        { ...items[0], status: "NONE", dst: "", name_dst: null },
        { ...items[1], status: "NONE", dst: "", name_dst: null },
        ...items.slice(2),
      ]);
      expect(await read_meta(database, lg_path, "translation_extras", {})).toMatchObject({
        total_line: 3,
        processed_line: 1,
        error_line: 0,
      });
    } finally {
      await database.close();
    }
  });
  it("混合导入仅文本生成 Item，PDF 替换和全部重置清空独立译稿", async () => {
    const { database, service, lg_path } = await create_service();
    try {
      const source = project_path("book.pdf");
      const text = project_path("story.txt");
      fs.writeFileSync(source, create_pdf_fixture());
      fs.writeFileSync(text, "Hello world");
      const revisions = async () =>
        (
          await database.read({ loaded: true, projectPath: lg_path }.projectPath, (access) =>
            new ProjectDataReader(access).build_manifest({ loaded: true, projectPath: lg_path }),
          )
        )["sectionRevisions"];
      await service.import_files({
        files: [
          { source_path: source, target_rel_path: "book.pdf" },
          { source_path: text, target_rel_path: "story.txt" },
        ],
        conflict_action: "replace",
        expected_section_revisions: (await revisions())!,
      });
      expect(await database.get_item_count(lg_path)).toBe(1);
      expect(
        await database.read(lg_path, (access) =>
          new ProjectDataReader(access).build_files_record_block(lg_path),
        ),
      ).toMatchObject({
        "book.pdf": { file_type: "PDF" },
        "story.txt": { file_type: "TXT" },
      });
      const old = (await database.read_pdf_document(lg_path, "book.pdf"))!;
      const update = {
        translation: { kind: "translate" as const, markdown: "已有译文" },
        reviewed: true,
        notes: "继续",
      };
      await database.transaction(lg_path, (writer) =>
        writer.write_pdf_page(lg_path, "book.pdf", { ...old.pages[0]!, ...update }),
      );
      fs.writeFileSync(source, create_pdf_fixture(["replacement"]));
      await service.import_files({
        files: [{ source_path: source, target_rel_path: "book.pdf" }],
        conflict_action: "replace",
        expected_section_revisions: (await revisions())!,
      });
      const next = (await database.read_pdf_document(lg_path, "book.pdf"))!;
      expect(next.pages[0]).toMatchObject({ translation: null, reviewed: false, notes: "" });
      expect(next.digest).not.toBe(old.digest);
      expect(next.pages).toHaveLength(1);
      await database.transaction(lg_path, (writer) =>
        writer.write_pdf_page(lg_path, "book.pdf", { ...next.pages[0]!, ...update }),
      );
      await service.reset_translation({ mode: "all" });
      expect((await database.read_pdf_document(lg_path, "book.pdf"))?.pages[0]).toMatchObject({
        translation: null,
        reviewed: false,
        notes: "",
      });
      expect(await database.get_item_count(lg_path)).toBe(1);
    } finally {
      await database.close();
    }
  });
  it("写入 settings-only 对齐结果且不 bump 运行态 section", async () => {
    const publish_project_change = vi.fn();
    const { database, service, lg_path } = await create_service(publish_project_change);

    const ack = await service.align_settings({
      mode: "settings_only",
      project_settings: {
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: false,
      },
    });

    expect(ack).toEqual({ accepted: true, changes: [] });
    expect(publish_project_change).not.toHaveBeenCalled();
    expect(await read_meta(database, lg_path, "source_language", "")).toBe("JA");
    await database.close();
  });

  it("显式 path 不存在时拒绝 settings-only 对齐且不创建空工程库", async () => {
    const { database, service } = await create_service();
    const missing_path = project_path("missing.lg");

    await expect(
      service.align_settings({
        path: missing_path,
        mode: "settings_only",
        project_settings: {
          source_language: "JA",
          target_language: "ZH",
        },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "project.not_found" }));

    expect(fs.existsSync(missing_path)).toBe(false);
    await database.close();
  });

  it.each(["空会话", "已加载其他工程"] as const)(
    "%s 时按目标路径对齐设置和条目，并保持会话隔离",
    async (session_kind) => {
      const publish_project_change = vi.fn(() => null);
      const { database, service, session_state } = await create_service(publish_project_change);
      try {
        if (session_kind === "空会话") await session_state.clear();
        const initial_session = session_state.snapshot();
        const other_lg_path = project_path("other.lg");
        const other_source_path = project_path("other.txt");
        fs.writeFileSync(other_source_path, "原文", "utf-8");
        await database.create_project(other_lg_path, "other");
        await database.transaction(other_lg_path, (writer) =>
          add_test_asset_from_source(
            writer,
            other_lg_path,
            "other.txt",
            other_source_path,
            null,
            0,
          ),
        );
        await database.transaction(other_lg_path, (writer) =>
          writer.set_meta(other_lg_path, "source_language", "JA"),
        );
        await database.transaction(other_lg_path, (writer) =>
          writer.set_items(other_lg_path, [
            create_persistent_item({ file_path: "other.txt", status: "LANGUAGE_SKIPPED" }),
          ]),
        );
        // 工程路径是读取契约的一部分，必须与本次对齐目标一致。
        const read_pdf_summaries = vi.spyOn(ProjectDatabaseAccess.prototype, "read_pdf_summaries");
        const ack = await service.align_settings({
          path: other_lg_path,
          mode: "prefiltered_items",
          expected_section_revisions: { items: 0 },
          project_settings: {
            source_language: "ALL",
            target_language: "ZH",
            mtool_optimizer_enable: false,
            skip_duplicate_source_text_enable: true,
          },
        });

        expect(read_pdf_summaries).toHaveBeenCalledWith(other_lg_path);
        expect(await read_meta(database, other_lg_path, "source_language", "")).toBe("ALL");
        expect(await database.get_all_items(other_lg_path)).toEqual([
          create_persistent_item({ file_path: "other.txt", status: "NONE" }),
        ]);
        expect(session_state.snapshot()).toEqual(initial_session);
        expect(ack).toEqual({ accepted: true, changes: [] });
        expect(publish_project_change).toHaveBeenCalledWith(
          expect.objectContaining({
            projectPath: other_lg_path,
            source: "settings_alignment",
            updatedSections: ["items"],
            items: { mode: "full", records: expect.any(Array) },
          }),
        );
      } finally {
        await database.close();
      }
    },
  );

  it("settings alignment 的 prefiltered_items 在当前工程发布 items 失效信号", async () => {
    const { publish_project_change } = create_test_project_change_publisher();
    const { database, service, lg_path } = await create_service(publish_project_change);
    await database.transaction(lg_path, (writer) =>
      writer.add_asset(lg_path, "a.txt", Buffer.from("原文"), "TXT", null),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [
        create_persistent_item({ src: "旧", file_path: "a.txt", row_number: 0 }),
      ]),
    );
    const ack = await service.align_settings({
      mode: "prefiltered_items",
      expected_section_revisions: { items: 0 },
      project_settings: {
        source_language: "ALL",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
      },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "settings_alignment",
          updatedSections: ["items"],
        },
      ],
    });
    expect(publish_project_change.mock.calls[0]?.[0]).toMatchObject({
      projectPath: lg_path,
      source: "settings_alignment",
      updatedSections: ["items"],
      items: { mode: "full", records: expect.any(Array) },
    });
    await database.close();
  });

  it("全部重置重建条目并发布全量失效", async () => {
    const { publish_project_change } = create_test_project_change_publisher();
    const { database, service, lg_path } = await create_service(publish_project_change);
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "新", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", source_path, null, 0),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [
        create_persistent_item({
          src: "旧",
          dst: "old",
          status: "PROCESSED",
          row_number: 0,
        }),
      ]),
    );

    const ack = await service.reset_translation({
      mode: "all",
      project_settings: { source_language: "JA", target_language: "ZH" },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "translation_reset",
          projectRevision: 1,
          sectionRevisions: { items: 1 },
          updatedSections: ["items"],
        },
      ],
    });
    expect(await database.get_all_items(lg_path)).toEqual([
      create_persistent_item({
        item_id: 2,
        src: "新",
        row_number: 0,
      }),
    ]);

    expect(publish_project_change.mock.calls[0]?.[0]).toMatchObject({
      projectPath: lg_path,
      source: "translation_reset",
      updatedSections: ["items"],
      items: { mode: "full", records: expect.any(Array) },
    });
    await database.close();
  });

  it.each([
    {
      file: "source.json",
      file_type: "KVJSON",
      content: JSON.stringify({ 翻訳済みの文章: "源文件译文", 未翻訳の文章: "" }),
    },
    {
      file: "source.trans",
      file_type: "TRANS",
      content: JSON.stringify({
        project: {
          files: {
            chapter: {
              data: [
                ["翻訳済みの文章", "源文件译文"],
                ["未翻訳の文章", ""],
              ],
            },
          },
        },
      }),
    },
  ])("全部重置从 $file 的工程资产恢复自带译文并重建进度", async ({ file, file_type, content }) => {
    const { database, service, lg_path } = await create_service();
    try {
      const source = project_path(file);
      fs.writeFileSync(source, content, "utf-8");
      await database.transaction(lg_path, (writer) =>
        add_test_asset_from_source(writer, lg_path, file, source, null, 0),
      );
      // 重置读取工程内的源文件快照，外部文件后续变化不参与恢复。
      fs.writeFileSync(source, "外部文件已变更", "utf-8");
      await database.transaction(lg_path, (writer) =>
        writer.set_items(lg_path, [
          create_persistent_item({
            item_id: 10,
            file_path: file,
            file_type,
            row_number: 0,
            src: "翻訳済みの文章",
            dst: "项目中修改后的译文",
            status: "PROCESSED",
          }),
          create_persistent_item({
            item_id: 11,
            file_path: file,
            file_type,
            row_number: 1,
            src: "未翻訳の文章",
            dst: "项目中新增的译文",
            status: "PROCESSED",
          }),
        ]),
      );
      await database.transaction(lg_path, (writer) =>
        writer.set_meta(lg_path, "translation_extras", {
          total_line: 2,
          line: 2,
          processed_line: 2,
          error_line: 0,
          total_tokens: 100,
          total_input_tokens: 60,
          total_output_tokens: 40,
          time: 12,
        }),
      );

      await service.reset_translation({ mode: "all", project_settings: { source_language: "JA" } });

      const items = (await database.get_all_items(lg_path)) as JsonRecord[];
      expect(items.map(({ src, dst, status }) => ({ src, dst, status }))).toEqual([
        { src: "翻訳済みの文章", dst: "源文件译文", status: "PROCESSED" },
        { src: "未翻訳の文章", dst: "", status: "NONE" },
      ]);
      expect(await read_meta(database, lg_path, "translation_extras", {})).toMatchObject({
        total_line: 2,
        line: 1,
        processed_line: 1,
        error_line: 0,
        total_tokens: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        time: 0,
      });
    } finally {
      await database.close();
    }
  });

  it.each(["第一行\n第二行\n第三行", "一行", ""])("全部重置允许条目数变化：%s", async (content) => {
    const { database, service, lg_path } = await create_service();
    const source = project_path("a.txt");
    fs.writeFileSync(source, content, "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", source, null, 0),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [
        create_persistent_item({ item_id: 20, row_number: 0, dst: "旧译文", status: "PROCESSED" }),
        create_persistent_item({ item_id: 21, row_number: 1 }),
      ]),
    );
    await service.reset_translation({ mode: "all" });
    const items = (await database.get_all_items(lg_path)) as JsonRecord[];
    const expected = content === "" ? [] : content.split("\n");
    expect(items.map((item) => item["src"])).toEqual(expected);
    expect(items.every((item) => Number(item["id"]) > 21 && item["dst"] === "")).toBe(true);
    await database.close();
    const reopened = new ProjectDatabase();
    expect(await reopened.get_all_items(lg_path)).toEqual(items);
    await reopened.close();
  });

  it.each(["missing", "parse", "commit"])(
    "全部重置在 %s 失败时保留条目和项目元数据",
    async (failure) => {
      const { database, service, lg_path } = await create_service();
      const file = failure === "parse" ? "a.json" : "a.txt";
      const source = project_path(file);
      fs.writeFileSync(source, "新正文", "utf-8");
      await database.transaction(lg_path, (writer) =>
        add_test_asset_from_source(writer, lg_path, file, source, null, 0),
      );
      await database.transaction(lg_path, (writer) =>
        writer.set_items(lg_path, [
          create_persistent_item({ file_path: file, dst: "已有译文", status: "PROCESSED" }),
        ]),
      );
      const before_items = await database.get_all_items(lg_path);
      const before_meta = await database.get_all_meta(lg_path);
      if (failure === "missing")
        vi.spyOn(database, "read_asset_content").mockResolvedValueOnce(null);
      if (failure === "commit") {
        const set_items = ProjectDatabaseAccess.prototype.set_items;
        vi.spyOn(ProjectDatabaseAccess.prototype, "set_items").mockImplementationOnce(function (
          this: ProjectDatabaseAccess,
          ...args
        ) {
          set_items.call(this, ...args);
          throw new Error("commit probe");
        });
      }
      await expect(service.reset_translation({ mode: "all" })).rejects.toThrow();
      expect(await database.get_all_items(lg_path)).toEqual(before_items);
      expect(await database.get_all_meta(lg_path)).toEqual(before_meta);
      await database.close();
    },
  );

  it("translation reset 拒绝旧最终事实载荷且不清空既有 items", async () => {
    const { database, service, lg_path } = await create_service();
    await database.transaction(lg_path, (writer) =>
      writer.add_asset(lg_path, "a.txt", Buffer.from("原文"), "TXT", null),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [create_persistent_item({ dst: "old", status: "PROCESSED" })]),
    );

    await expect(
      service.reset_translation({
        mode: "all",
        items: [create_public_item()],
        translation_extras: {},
        prefilter_config: {},
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "request.validation_failed" }));

    expect(await database.get_all_items(lg_path)).toEqual([
      create_persistent_item({ dst: "old", status: "PROCESSED" }),
    ]);
    await database.close();
  });

  it("translation reset all 解析窗口内拒绝另一段结构性 write", async () => {
    const { database, service, lg_path } = await create_service();
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "新", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", source_path, null, 0),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [
        create_persistent_item({
          src: "新",
          dst: "old",
          status: "ERROR",
          row_number: 0,
        }),
      ]),
    );
    const { parse_started, release_parse } = pause_next_parse_asset();

    const reset_all_promise = service.reset_translation({
      mode: "all",
      project_settings: { source_language: "JA", target_language: "ZH" },
    });
    await parse_started;
    try {
      await expect(
        service.reset_translation({
          mode: "failed",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "runtime.busy" }));
    } finally {
      release_parse();
    }

    await expect(reset_all_promise).resolves.toMatchObject({ accepted: true });
    expect(await database.get_all_items(lg_path)).toEqual([
      create_persistent_item({
        item_id: 2,
        src: "新",
        dst: "",
        status: "NONE",
        row_number: 0,
      }),
    ]);
    await database.close();
  });

  it("settings alignment 的 prefiltered_items 拒绝旧最终事实载荷", async () => {
    const { database, service, lg_path } = await create_service();
    await database.transaction(lg_path, (writer) =>
      writer.add_asset(lg_path, "a.txt", Buffer.from("原文"), "TXT", null),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [create_persistent_item()]),
    );

    await expect(
      service.align_settings({
        mode: "prefiltered_items",
        items: [create_public_item()],
        translation_extras: {},
        prefilter_config: {},
        project_settings: { source_language: "JA" },
        expected_section_revisions: { items: 0 },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "request.validation_failed" }));

    expect(await database.get_all_items(lg_path)).toEqual([create_persistent_item()]);
    await database.close();
  });

  it("导入工作台文件解析窗口内拒绝另一段结构性 write", async () => {
    const { database, service, lg_path } = await create_service();
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "旧", "utf-8");
    fs.writeFileSync(second_source, "新", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", first_source, null, 0),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [
        create_persistent_item({
          src: "旧",
          dst: "old",
          status: "ERROR",
          row_number: 0,
        }),
      ]),
    );
    const { parse_started, release_parse } = pause_next_parse_asset();

    const import_files_promise = service.import_files({
      files: [{ source_path: second_source, target_rel_path: "b.txt" }],
      conflict_action: "skip",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0 },
    });
    await parse_started;
    try {
      await expect(
        service.reset_translation({
          mode: "failed",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "runtime.busy" }));
    } finally {
      release_parse();
    }

    await expect(import_files_promise).resolves.toMatchObject({ accepted: true });
    expect(await database.get_all_asset_records(lg_path)).toEqual([
      { path: "a.txt", sort_order: 0, file_type: "TXT" },
      { path: "b.txt", sort_order: 1, file_type: "TXT" },
    ]);
    expect(await database.get_all_items(lg_path)).toEqual([
      create_persistent_item({
        src: "旧",
        dst: "old",
        status: "ERROR",
        row_number: 0,
      }),
      create_persistent_item({
        item_id: 2,
        src: "新",
        file_path: "b.txt",
        row_number: 0,
      }),
    ]);
    await database.close();
  });

  it("导入同名工作台文件选择跳过时只新增非同名文件", async () => {
    const { database, service, lg_path } = await create_service();
    const old_source = project_path("a.txt");
    const conflict_source = project_path("a-new.txt");
    const new_source = project_path("b.txt");
    fs.writeFileSync(old_source, "旧", "utf-8");
    fs.writeFileSync(conflict_source, "替换候选", "utf-8");
    fs.writeFileSync(new_source, "新", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", old_source, null, 0),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [create_persistent_item({ src: "旧", dst: "old", row_number: 0 })]),
    );

    await service.import_files({
      files: [
        { source_path: conflict_source, target_rel_path: "a.txt" },
        { source_path: new_source, target_rel_path: "b.txt" },
      ],
      conflict_action: "skip",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0 },
    });

    expect(await database.get_all_asset_records(lg_path)).toEqual([
      { path: "a.txt", sort_order: 0, file_type: "TXT" },
      { path: "b.txt", sort_order: 1, file_type: "TXT" },
    ]);
    expect(await database.get_all_items(lg_path)).toEqual([
      create_persistent_item({ src: "旧", dst: "old", row_number: 0 }),
      create_persistent_item({ item_id: 2, src: "新", file_path: "b.txt", row_number: 0 }),
    ]);
    expect((await database.read_asset_content(lg_path, "a.txt"))?.toString("utf-8")).toBe("旧");
    await database.close();
  });

  it("导入工作台文件时跳过最终解析失败文件并继续写入成功文件", async () => {
    const log_manager = create_log_manager();
    const { database, service, lg_path } = await create_service(undefined, log_manager);
    const valid_source = project_path("valid.txt");
    const broken_json = project_path("broken.json");
    fs.writeFileSync(valid_source, "新", "utf-8");
    fs.writeFileSync(broken_json, "{", "utf-8");
    const ack = await service.import_files({
      files: [
        { source_path: valid_source, target_rel_path: "valid.txt" },
        { source_path: broken_json, target_rel_path: "broken.json" },
      ],
      conflict_action: "replace",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      failed_files: [
        {
          source_path: broken_json,
          rel_path: "broken.json",
          filename: "broken.json",
          code: "file.parse_failed",
          message: expect.any(String),
        },
      ],
    });
    expect(await database.get_all_asset_records(lg_path)).toEqual([
      { path: "valid.txt", sort_order: 0, file_type: "TXT" },
    ]);
    expect(await database.get_all_items(lg_path)).toEqual([
      create_persistent_item({ src: "新", file_path: "valid.txt", row_number: 0 }),
    ]);
    expect(log_manager.warning).toHaveBeenCalledWith(
      expect.stringContaining("broken.json"),
      expect.objectContaining({ source: "project-import" }),
    );
    await database.close();
  });

  it("导入工作台文件全部解析失败时不写入工程并返回失败明细", async () => {
    const log_manager = create_log_manager();
    const { database, service, lg_path } = await create_service(undefined, log_manager);
    const broken_json = project_path("broken.json");
    fs.writeFileSync(broken_json, "{", "utf-8");

    await expect(
      service.import_files({
        files: [{ source_path: broken_json, target_rel_path: "broken.json" }],
        conflict_action: "replace",
        project_settings: { source_language: "JA", target_language: "ZH" },
        expected_section_revisions: { files: 0, items: 0 },
      }),
    ).rejects.toMatchObject({
      code: "file.parse_failed",
      public_details: {
        failed_files: [
          {
            source_path: broken_json,
            rel_path: "broken.json",
            filename: "broken.json",
            code: "file.parse_failed",
            message: expect.any(String),
          },
        ],
      },
    });

    expect(await database.get_all_asset_records(lg_path)).toEqual([]);
    expect(log_manager.warning).toHaveBeenCalledWith(
      expect.stringContaining("broken.json"),
      expect.objectContaining({ source: "project-import" }),
    );
    await database.close();
  });

  it.each(["delete", "replace"] as const)(
    "代表文件 %s 后由其它文件的重复项接任",
    async (action) => {
      const { publish_project_change } = create_test_project_change_publisher();
      const { database, service, lg_path } = await create_service(publish_project_change);
      try {
        await database.transaction(lg_path, (writer) =>
          writer.add_asset(lg_path, "a.txt", Buffer.from("同文"), "TXT", null),
        );
        await database.transaction(lg_path, (writer) =>
          writer.add_asset(lg_path, "b.txt", Buffer.from("同文"), "TXT", null),
        );
        await database.transaction(lg_path, (writer) =>
          writer.set_meta(lg_path, "skip_duplicate_source_text_enable", true),
        );
        await database.transaction(lg_path, (writer) =>
          writer.set_items(lg_path, [
            create_persistent_item({ item_id: 1, src: "同文", file_path: "a.txt", status: "NONE" }),
            create_persistent_item({
              item_id: 2,
              src: "同文",
              file_path: "b.txt",
              status: "DUPLICATED",
            }),
          ]),
        );
        const request = {
          project_settings: { source_language: "ZH", skip_duplicate_source_text_enable: true },
          expected_section_revisions: { files: 0, items: 0 },
        };
        if (action === "delete") {
          await service.delete_files({ ...request, rel_paths: ["a.txt"] });
        } else {
          const source = project_path("replacement.txt");
          fs.writeFileSync(source, "新文", "utf8");
          await service.import_files({
            ...request,
            files: [{ source_path: source, target_rel_path: "a.txt" }],
            conflict_action: "replace",
          });
        }
        expect((await database.get_all_items(lg_path)).find((item) => item.id === 2)).toMatchObject(
          {
            status: "NONE",
            file_path: "b.txt",
          },
        );
        expect(await read_meta(database, lg_path, "translation_extras", {})).toMatchObject({
          total_line: action === "delete" ? 1 : 2,
        });
        expect(publish_project_change.mock.calls[0]?.[0]).toMatchObject({
          items: {
            mode: "full",
            records: expect.arrayContaining([
              expect.objectContaining({ item_id: 2, status: "NONE" }),
            ]),
          },
        });
      } finally {
        await database.close();
      }
    },
  );

  it("导入同名工作台文件选择替换时保留排序并重建条目", async () => {
    const { publish_project_change } = create_test_project_change_publisher();
    const { database, service, lg_path } = await create_service(publish_project_change);
    const old_source = project_path("a.txt");
    const replace_source = project_path("a-new.txt");
    fs.writeFileSync(old_source, "旧", "utf-8");
    fs.writeFileSync(replace_source, "新", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", old_source, null, 3),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [create_persistent_item({ src: "旧", dst: "old", row_number: 0 })]),
    );

    const ack = await service.import_files({
      files: [{ source_path: replace_source, target_rel_path: "a.txt" }],
      conflict_action: "replace",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "project_import_files",
          updatedSections: ["files", "items"],
        },
      ],
    });
    expect(await database.get_all_asset_records(lg_path)).toEqual([
      { path: "a.txt", sort_order: 3, file_type: "TXT" },
    ]);
    expect((await database.read_asset_content(lg_path, "a.txt"))?.toString("utf-8")).toBe("新");
    expect(await database.get_all_items(lg_path)).toEqual([
      create_persistent_item({ item_id: 2, src: "新", file_path: "a.txt", row_number: 0 }),
    ]);

    expect(publish_project_change.mock.calls[0]?.[0]).toMatchObject({
      projectPath: lg_path,
      source: "project_import_files",
      updatedSections: ["files", "items"],
      items: { mode: "full", records: expect.any(Array) },
    });
    await database.close();
  });

  it("导入同名工作台文件选择替换并继承译文", async () => {
    const { database, service, lg_path } = await create_service();
    const old_source = project_path("a.txt");
    const replace_source = project_path("a-new.txt");
    fs.writeFileSync(old_source, "同文", "utf-8");
    fs.writeFileSync(replace_source, "同文", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", old_source, null, 2),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [
        create_persistent_item({
          src: "同文",
          dst: "译文",
          status: "PROCESSED",
          row_number: 0,
        }),
      ]),
    );
    await service.import_files({
      files: [{ source_path: replace_source, target_rel_path: "a.txt" }],
      conflict_action: "replace",
      inheritance_mode: "inherit",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0 },
    });

    expect(await database.get_all_items(lg_path)).toEqual([
      create_persistent_item({
        item_id: 2,
        src: "同文",
        dst: "译文",
        status: "PROCESSED",
        file_path: "a.txt",
        row_number: 0,
      }),
    ]);
    await database.close();
  });

  it("整条继承匹配源身份，按完整结果投票并支持空正文", async () => {
    const { database, service, lg_path } = await create_service();
    try {
      const source_path = project_path("names.json");
      fs.writeFileSync(
        source_path,
        JSON.stringify([
          { name: "太郎", message: "こんにちは" },
          { name: "花子", message: "こんにちは" },
          { name: "俊輔", message: "" },
        ]),
      );
      await database.transaction(lg_path, (writer) =>
        writer.add_asset(lg_path, "old.json", Buffer.from("[]"), "MESSAGEJSON", null),
      );
      await database.transaction(lg_path, (writer) =>
        writer.add_asset(lg_path, "old.rpy", Buffer.from(""), "RENPY", null),
      );
      await database.transaction(lg_path, (writer) =>
        writer.set_items(
          lg_path,
          (
            [
              // 相同正文的译名分开投票，同票时保留最早的完整结果。
              ["こんにちは", "你好", "太郎", "少数译名", "KAG"],
              ["こんにちは", "你好", "太郎", "太郎译名", "KAG"],
              ["こんにちは", "你好", "太郎", "太郎译名", "KAG"],
              ["こんにちは", "错误类型译文", "花子", "错误类型译名", "RENPY"],
              ["", "", "俊輔", "俊辅", "KAG"],
              ["", "", "俊輔", "另一个译名", "KAG"],
            ] as const
          ).map(([src, dst, name_src, name_dst, text_type], index) =>
            create_persistent_item({
              item_id: index + 1,
              src,
              dst,
              name_src,
              name_dst,
              file_type: text_type === "KAG" ? "MESSAGEJSON" : "RENPY",
              file_path: text_type === "KAG" ? "old.json" : "old.rpy",
              status: "PROCESSED",
            }),
          ),
        ),
      );
      await service.import_files({
        files: [{ source_path, target_rel_path: "names.json" }],
        inheritance_mode: "inherit",
        conflict_action: "replace",
        project_settings: { source_language: "JA", target_language: "ZH" },
        expected_section_revisions: { files: 0, items: 0 },
      });
      expect(
        ((await database.get_all_items(lg_path)) as JsonRecord[]).filter(
          (item) => item.file_path === "names.json",
        ),
      ).toMatchObject([
        {
          src: "こんにちは",
          name_src: "太郎",
          dst: "你好",
          name_dst: "太郎译名",
          status: "PROCESSED",
        },
        { src: "こんにちは", name_src: "花子", dst: "", name_dst: null, status: "DUPLICATED" },
        { src: "", name_src: "俊輔", dst: "", name_dst: "俊辅", status: "PROCESSED" },
      ]);
    } finally {
      await database.close();
    }
  });

  it("预览、导入、缓存查询和工作台命令按准确路径区分空格文件，并关联 KVJSON 与 PDF 事实", async () => {
    const { database, service, session_state, lg_path } = await create_service();
    const settings = {
      source_language: "ALL",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: false,
    };
    const app_settings = {
      read_setting: () => ({ ...settings, target_language: "ZH" }),
    } as unknown as AppSettingService;
    const cache = new CacheManager({
      database,
      logManager: null,
      appSettingService: app_settings,
      workerClient: { run: vi.fn(), dispose: vi.fn() } as unknown as ComputeWorkerClient,
    });
    const summary = new ProjectSummaryService(session_state, cache);
    const source_paths = [" a.json", "a.json", " book.pdf"].map(project_path);
    fs.writeFileSync(source_paths[0]!, JSON.stringify({ "line\nother": "", line: "" }));
    fs.writeFileSync(source_paths[1]!, JSON.stringify({ plain: "" }));
    fs.writeFileSync(source_paths[2]!, create_pdf_fixture());
    try {
      const preview = await service.parse_project_file({ source_paths });
      const parsed_files = preview.files as unknown as WorkbenchFileParsePreview[];
      expect(parsed_files.map((file) => file.target_rel_path)).toEqual([
        " a.json",
        "a.json",
        " book.pdf",
      ]);
      expect(parsed_files.map((file) => file.source_path)).toEqual(source_paths);
      const import_plan = create_workbench_import_files_plan({
        state: { files: [], section_revisions: { files: 0, items: 0 } },
        parsed_files,
        settings,
        conflict_action: "skip",
      });
      await service.import_files(import_plan.requestBody as JsonRecord);
      const imported = await database.get_all_items(lg_path);
      expect(
        imported.filter((item) => item.file_path === " a.json").map((item) => item.status),
      ).toEqual(["NONE", "RULE_SKIPPED"]);
      expect(
        imported.filter((item) => item.file_path === "a.json").map((item) => item.src),
      ).toEqual(["plain"]);
      await database.transaction(lg_path, (writer) =>
        writer.set_items(
          lg_path,
          imported.map((item) => ({ ...item, dst: "keep", status: "PROCESSED" })),
        ),
      );
      /** 从真实缓存查询获取命令路径与修订，覆盖持久化后的消费链。 */
      async function read_planning_state() {
        await cache.warmProject(lg_path);
        const result = await summary.read();
        return { files: result.snapshot.entries, section_revisions: result.sectionRevisions };
      }
      let state = await read_planning_state();
      expect(state.files.map((file) => file.rel_path)).toEqual([" a.json", "a.json", " book.pdf"]);
      expect(state.files.find((file) => file.rel_path === " book.pdf")).toMatchObject({
        file_type: "PDF",
        progress: { unit: "page", total_count: 3 },
      });
      const reset = create_workbench_reset_file_plan({ state, rel_path: " a.json", settings });
      await service.reset_files(reset.requestBody as JsonRecord);
      expect(
        (await database.get_all_items(lg_path))
          .filter((item) => item.file_path === " a.json")
          .map((item) => [item.dst, item.status]),
      ).toEqual([
        ["", "NONE"],
        ["", "RULE_SKIPPED"],
      ]);
      expect(
        (await database.get_all_items(lg_path)).find((item) => item.file_path === "a.json")?.dst,
      ).toBe("keep");
      state = await read_planning_state();
      const order = [" book.pdf", "a.json", " a.json"];
      await service.reorder_files(
        create_workbench_reorder_plan({ state, ordered_rel_paths: order })
          .requestBody as JsonRecord,
      );
      state = await read_planning_state();
      expect(state.files.map((file) => file.rel_path)).toEqual(order);
      await service.delete_files(
        create_workbench_delete_files_plan({ state, rel_paths: [" a.json"], settings })
          .requestBody as JsonRecord,
      );
      expect((await database.get_all_asset_records(lg_path)).map((file) => file.path)).toEqual([
        " book.pdf",
        "a.json",
      ]);
      expect((await database.get_all_items(lg_path)).map((item) => item.file_path)).toEqual([
        "a.json",
      ]);
      expect((await read_planning_state()).files.map((file) => file.rel_path)).toEqual([
        " book.pdf",
        "a.json",
      ]);
    } finally {
      await database.close();
    }
  });

  it("按完整文件集合重排 assets 并只 bump files section", async () => {
    const { publish_project_change } = create_test_project_change_publisher();
    const { database, service, lg_path } = await create_service(publish_project_change);
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "a", "utf-8");
    fs.writeFileSync(second_source, "b", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", first_source, null, 0),
    );
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "b.txt", second_source, null, 1),
    );

    const ack = await service.reorder_files({
      ordered_rel_paths: ["b.txt", "a.txt"],
      expected_section_revisions: { files: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "project_reorder_files",
          projectRevision: 1,
          sectionRevisions: { files: 1 },
          updatedSections: ["files"],
        },
      ],
    });
    expect(await database.get_all_asset_records(lg_path)).toEqual([
      { path: "b.txt", sort_order: 0, file_type: "TXT" },
      { path: "a.txt", sort_order: 1, file_type: "TXT" },
    ]);
    expect(publish_project_change.mock.calls[0]?.[0]).toMatchObject({
      projectPath: lg_path,
      source: "project_reorder_files",
      updatedSections: ["files"],
    });
    await database.close();
  });

  it("工作台 reset-file 只写顶层计算 meta 白名单", async () => {
    const { publish_project_change } = create_test_project_change_publisher();
    const { database, service, lg_path } = await create_service(publish_project_change);
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "a", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", source_path, null, 0),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [
        create_persistent_item({
          src: "旧",
          dst: "old",
          file_path: "a.txt",
          status: "PROCESSED",
          row_number: 0,
        }),
      ]),
    );
    await service.reset_files({
      rel_paths: ["a.txt"],
      project_settings: { source_language: "JA" },
      expected_section_revisions: { items: 0 },
    });

    expect(await read_meta(database, lg_path, "translation_extras", {})).toMatchObject({
      processed_line: 0,
      error_line: 0,
      total_line: 1,
      line: 0,
    });
    expect(await read_meta(database, lg_path, "prefilter_config", {})).toEqual({
      source_language: "JA",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: true,
    });
    expect(publish_project_change.mock.calls[0]?.[0]).toMatchObject({
      projectPath: lg_path,
      source: "project_reset_files",
      updatedSections: ["items"],
      items: { mode: "full", records: expect.any(Array) },
    });
    await database.close();
  });

  it("删除工作台文件时删除 files 和对应 items", async () => {
    const { publish_project_change } = create_test_project_change_publisher();
    const { database, service, lg_path } = await create_service(publish_project_change);
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "a", "utf-8");
    fs.writeFileSync(second_source, "b", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", first_source, null, 0),
    );
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "b.txt", second_source, null, 1),
    );
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [
        create_persistent_item({ src: "删除", file_path: "a.txt", row_number: 0 }),
        create_persistent_item({
          item_id: 2,
          src: "保留",
          file_path: "b.txt",
          row_number: 0,
        }),
      ]),
    );
    const ack = await service.delete_files({
      rel_paths: ["a.txt"],
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "project_delete_files",
          updatedSections: ["files", "items"],
        },
      ],
    });
    expect(await database.get_all_asset_records(lg_path)).toEqual([
      { path: "b.txt", sort_order: 1, file_type: "TXT" },
    ]);
    expect(await database.get_all_items(lg_path)).toEqual([
      create_persistent_item({ item_id: 2, src: "保留", file_path: "b.txt", row_number: 0 }),
    ]);
    expect(publish_project_change.mock.calls[0]?.[0]).toMatchObject({
      projectPath: lg_path,
      source: "project_delete_files",
      updatedSections: ["files", "items"],
      items: { mode: "full", records: expect.any(Array) },
    });
    await database.close();
  });

  it("任务忙碌时拒绝 translation reset 且不写库", async () => {
    const { database, service, runtime_gate, lg_path } = await create_service();
    runtime_gate.begin_runtime("batch_translation");
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [
        { id: 1, src: "旧", dst: "old", status: "PROCESSED", file_type: "NONE" },
      ]),
    );

    await expect(
      service.reset_translation({
        mode: "all",
        project_settings: { source_language: "JA" },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "runtime.busy" }));

    expect(await database.get_all_items(lg_path)).toEqual([
      { id: 1, src: "旧", dst: "old", status: "PROCESSED", file_type: "NONE" },
    ]);
    await database.close();
  });

  it("任务忙碌时拒绝 settings-only 对齐且不写设置 meta", async () => {
    const { database, service, runtime_gate, lg_path } = await create_service();
    runtime_gate.begin_runtime("batch_translation");

    await expect(
      service.align_settings({
        mode: "settings_only",
        project_settings: { source_language: "JA" },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "runtime.busy" }));

    expect(await read_meta(database, lg_path, "source_language", "")).toBe("");
    await database.close();
  });

  it("任务忙碌时拒绝工作台文件 write 且不写库", async () => {
    const { database, service, runtime_gate, lg_path } = await create_service();
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "a", "utf-8");
    fs.writeFileSync(second_source, "b", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", first_source, null, 0),
    );
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "b.txt", second_source, null, 1),
    );
    runtime_gate.begin_runtime("batch_translation");

    await expect(
      service.reorder_files({
        ordered_rel_paths: ["b.txt", "a.txt"],
        expected_section_revisions: { files: 0 },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "runtime.busy" }));

    expect(await database.get_all_asset_records(lg_path)).toEqual([
      { path: "a.txt", sort_order: 0, file_type: "TXT" },
      { path: "b.txt", sort_order: 1, file_type: "TXT" },
    ]);
    await database.close();
  });

  it("工作台 write 中途失败时仍释放文件 guard", async () => {
    const { database, service, lg_path } = await create_service();
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "a", "utf-8");
    await database.transaction(lg_path, (writer) =>
      add_test_asset_from_source(writer, lg_path, "a.txt", source_path, null, 0),
    );
    const transaction_spy = vi.spyOn(database, "transaction").mockImplementation(async () => {
      throw new Error("事务失败");
    });

    await expect(
      service.reorder_files({
        ordered_rel_paths: ["a.txt"],
        expected_section_revisions: { files: 0 },
      }),
    ).rejects.toThrow("事务失败");

    transaction_spy.mockRestore();
    await expect(
      service.reorder_files({
        ordered_rel_paths: ["a.txt"],
        expected_section_revisions: { files: 0 },
      }),
    ).resolves.toMatchObject({
      accepted: true,
      changes: [
        {
          source: "project_reorder_files",
          projectRevision: 1,
          sectionRevisions: { files: 1 },
          updatedSections: ["files"],
        },
      ],
    });
    await database.close();
  });

  it("翻译重置命令拒绝旧 revision 字段", async () => {
    const { database, service, lg_path } = await create_service();
    await database.transaction(lg_path, (writer) =>
      writer.set_meta(lg_path, "project_runtime_revision.items", 2),
    );

    await expect(
      service.reset_translation({
        mode: "failed",
        expected_section_revisions: { items: 1 },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "request.validation_failed" }));

    await database.close();
  });
});

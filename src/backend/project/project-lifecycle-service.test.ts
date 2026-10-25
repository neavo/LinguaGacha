import { FileFormatService } from "../file/file-format-service";
import { GameDirectoryOperations } from "../file/shared/game/game-directory-operations";
import { evb_fixture } from "../../test/evb-fixture";
import { wolf_files } from "../../test/wolf-fixture";
import { wolf_archive_fixture } from "../../test/wolf-archive-fixture";
import { create_godot_fixture, godot_pack_fixture } from "../../test/godot-fixture";
import { ProjectDatabaseAccess } from "../database/database-operations";
import { create_pdf_execution } from "../file/pdf/test-support";
import { read_zip_fixture, zip_text } from "../../test/zip-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSessionState } from "./project-session-state";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectDataSnapshot } from "./project-data-reader";
type CacheLifecycleCall = { projectPath: string; snapshot?: ProjectDataSnapshot };
type CacheLifecycleHandler = (call: CacheLifecycleCall) => void;
import { DatabaseSync } from "node:sqlite";
import { ProjectDatabase } from "../database/database-operations";
import type { MutableJsonRecord } from "../../domain/json";
import type { LogManager } from "../log/log-manager";
import type { AppSettingService } from "../app/app-setting-service";
import { AppPathService } from "../app/app-path-service";
import { ProjectLifecycleService } from "./project-lifecycle-service";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectWriteStore } from "./project-write-store";
import { create_item } from "../../domain/item";
import {
  DEFAULT_PROJECT_LANGUAGE_SETTINGS,
  type ProjectLanguageSettings,
} from "../../domain/project-settings";

type TestProjectDatabase = ProjectDatabase & {
  upsert_meta_entries: ReturnType<typeof vi.fn>;
  patch_item_translation_fields: ReturnType<typeof vi.fn>;
  read_project_preview: ReturnType<typeof vi.fn>;
  close_project: ReturnType<typeof vi.fn>;
  create_project: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

describe("ProjectLifecycleService", () => {
  const cleanup_paths: string[] = []; // 生命周期测试会创建真实临时文件，统一登记清理避免污染用户工作区

  it.each([false, true])("正式创建只发现一次，游戏通知先于本批全部准备：%s", async (games) => {
    const root = create_temp_dir();
    const paths = games
      ? ["first", "second"].map((name) => {
          const game = path.join(root, name);
          fs.mkdirSync(game);
          fs.writeFileSync(path.join(game, "game.pck"), godot_pack_fixture(create_godot_fixture()));
          return game;
        })
      : [write_file(path.join(root, "text.txt"), "原文")];
    const database = new ProjectDatabase("1.0.0");
    const service = create_service({ database });
    const discover = vi.spyOn(FileFormatService.prototype, "collect_source_file_entries");
    const notify = vi.fn(() => {
      for (const game of paths) {
        expect(fs.readdirSync(game)).toEqual(["game.pck"]);
      }
    });
    try {
      const project = path.join(root, "new.lg");
      await service.create_project_commit({ path: project, source_paths: paths }, notify);
      expect(discover).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(games ? 1 : 0);
      expect(await database.get_all_asset_records(project)).toHaveLength(paths.length);
      if (games)
        for (const game of paths) expect(fs.existsSync(path.join(game, "game.pck"))).toBe(false);
    } finally {
      discover.mockRestore();
      await database.close();
    }
  });

  it("新建来源摘要只读，确认顺序传到准备，错误顺序不创建工程", async () => {
    const root = create_temp_dir(),
      game = path.join(root, "ordered"),
      project = path.join(root, "ordered.lg");
    fs.mkdirSync(game);
    for (const [name, text] of [
      ["game.pck", "base"],
      ["patch2.pck", "two"],
      ["patch10.pck", "ten"],
    ])
      fs.writeFileSync(
        path.join(game, name!),
        godot_pack_fixture(new Map([...create_godot_fixture(), ["main.gd", Buffer.from(text!)]])),
      );
    const database = new ProjectDatabase("1.0.0"),
      service = create_service({ database });
    try {
      expect((await service.summarize_source_files({ source_paths: [game] })).godot_packs).toEqual([
        {
          game_root: game,
          game_name: "ordered",
          external_pcks: ["game.pck", "patch2.pck", "patch10.pck"],
        },
      ]);
      expect(fs.readdirSync(game).sort()).toEqual(["game.pck", "patch10.pck", "patch2.pck"]);
      await expect(
        service.create_project_commit({
          path: project,
          source_paths: [game],
          godot_pack_orders: [{ game_root: game, ordered_pcks: ["game.pck"] }],
        }),
      ).rejects.toMatchObject({ code: "request.validation_failed" });
      expect(fs.existsSync(project)).toBe(false);
      expect(fs.existsSync(path.join(game, "backup_lg"))).toBe(false);
      await service.create_project_commit({
        path: project,
        source_paths: [game],
        godot_pack_orders: [
          { game_root: game, ordered_pcks: ["game.pck", "patch10.pck", "patch2.pck"] },
        ],
      });
      expect(fs.readFileSync(path.join(game, "main.gd"), "utf8")).toBe("two");
      expect(await database.get_all_asset_records(project)).toHaveLength(1);
    } finally {
      await database.close();
    }
  });

  it("新建时忽略直接包文件，游戏原件保持完整", async () => {
    const root = create_temp_dir();
    const game = path.join(root, "game");
    const pack = godot_pack_fixture(create_godot_fixture());
    fs.mkdirSync(game);
    const carrier = path.join(game, "game.pck");
    fs.writeFileSync(carrier, pack);
    const database = new ProjectDatabase("1.0.0");
    const service = create_service({ database });
    try {
      const empty = path.join(root, "empty.lg");
      await service.create_project_commit({ path: empty, source_paths: [carrier] });
      expect(await database.get_all_asset_records(empty)).toEqual([]);
      expect(fs.readdirSync(game)).toEqual(["game.pck"]);
      expect(fs.readFileSync(carrier).equals(pack)).toBe(true);
    } finally {
      await database.close();
    }
  });

  it("新建复用预过滤条目，重开读取数据库且安装一致快照", async () => {
    const root = create_temp_dir();
    const project_path = path.join(root, "current.lg");
    const source = write_file(path.join(root, "source.txt"), "こんにちは\nこんにちは");
    const trans = write_file(
      path.join(root, "game.trans"),
      JSON.stringify({
        project: { gameEngine: "kag", files: { chapter: { data: [["こんにちは", ""]] } } },
      }),
    );
    const game = path.join(root, "game");
    const exe = write_file(path.join(game, "GamePro.exe"));
    fs.writeFileSync(path.join(game, "dialogue.json"), "{");
    fs.writeFileSync(
      path.join(game, "Data.wolf"),
      await wolf_archive_fixture(
        new Map([...wolf_files()].map(([name, bytes]) => [name.slice(5), bytes])),
        0,
      ),
    );
    const database = new ProjectDatabase("1.0.0");
    const snapshots: ProjectDataSnapshot[] = [];
    const service = create_service({
      database,
      project_event_handler: ({ snapshot }) => {
        if (snapshot) snapshots.push(snapshot);
      },
    });
    try {
      const reads = vi.spyOn(ProjectDatabaseAccess.prototype, "get_all_items");
      await service.create_project_commit({
        path: project_path,
        source_paths: [source, trans, exe],
      });
      expect(reads).not.toHaveBeenCalled();
      expect(snapshots[0]?.meta).toMatchObject({
        glossary_enable: true,
        additional_files: { "game.wolfrpg": ["dialogue.json"] },
        translation_prompt_legacy_migrated: true,
        "migration.asset_file_type_complete": true,
      });
      expect(snapshots[0]?.files["game.trans"]).toMatchObject({ game_engine: "kag" });
      expect(snapshots[0]?.files["game.wolfrpg"]).toMatchObject({ file_type: "WOLFRPG" });
      expect(snapshots[0]!.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ src: "原文", file_type: "WOLFRPG" })]),
      );
      reads.mockClear();
      await service.load_project({ path: project_path });
      expect(reads).toHaveBeenCalledTimes(1);
      expect(snapshots).toHaveLength(2);
      const { meta: first_meta, ...created } = snapshots[0]!;
      const { meta: second_meta, ...loaded } = snapshots[1]!;
      expect(loaded).toEqual(created);
      expect(second_meta.translation_extras).toEqual(first_meta.translation_extras);
      expect(second_meta.additional_files).toEqual(first_meta.additional_files);
    } finally {
      await database.close();
    }
  });

  it.each(["create", "load"] as const)("%s 快照准备失败回滚且不发布", async (operation) => {
    const project_path = path.join(create_temp_dir(), "rollback.lg");
    const database = new ProjectDatabase("1.0.0");
    const session_state = create_session_state();
    const publish = vi.fn();
    try {
      if (operation === "load") {
        await database.create_project(project_path, "old");
        await database.transaction(project_path, (writer) =>
          writer.set_meta(project_path, "updated_at", "before"),
        );
      }
      vi.spyOn(ProjectDatabaseAccess.prototype, "get_rules").mockImplementationOnce(() => {
        throw new Error("snapshot failed");
      });
      const service = create_service({ database, session_state, project_event_handler: publish });
      await expect(
        operation === "create"
          ? service.create_project_commit({ path: project_path, source_paths: [] })
          : service.load_project({ path: project_path }),
      ).rejects.toThrow("snapshot failed");
      expect(publish).not.toHaveBeenCalled();
      expect(session_state.snapshot().loaded).toBe(false);
      if (operation === "create") expect(fs.existsSync(project_path)).toBe(false);
      else
        expect(await database.get_all_meta(project_path)).toMatchObject({ updated_at: "before" });
    } finally {
      await database.close();
    }
  });

  it("新建提交后缓存失败保留工程，重开能恢复当前事实", async () => {
    const project_path = path.join(create_temp_dir(), "committed.lg");
    const database = new ProjectDatabase("1.0.0");
    const session_state = create_session_state();
    const publish = vi.fn().mockImplementationOnce(() => {
      throw new Error("install failed");
    });
    const service = create_service({ database, session_state, project_event_handler: publish });
    try {
      await expect(
        service.create_project_commit({ path: project_path, source_paths: [] }),
      ).rejects.toMatchObject({
        code: "data.committed_sync_failed",
        public_details: { committed: true, action: "reload_project" },
      });
      expect(fs.existsSync(project_path)).toBe(true);
      expect(session_state.snapshot().loaded).toBe(false);
      await service.load_project({ path: project_path });
      expect(session_state.snapshot()).toEqual({ loaded: true, projectPath: project_path });
    } finally {
      await database.close();
    }
  });

  afterEach(() => {
    while (cleanup_paths.length > 0) {
      fs.rmSync(cleanup_paths.pop() ?? "", { force: true, recursive: true });
    }
  });

  it.each(["close", "cache"])("加载提交后 %s 失败保留事实与恢复信息", async (phase) => {
    const project_path = path.join(create_temp_dir(), "scope.lg");
    const database = new ProjectDatabase("1.0.0");
    await database.create_project(project_path, "scope");
    await database.transaction(project_path, (writer) =>
      writer.set_meta(project_path, "updated_at", "before"),
    );
    const failure = new Error(phase + " failed");
    const service = create_service({
      database,
      project_event_handler: () => {
        if (phase === "cache") throw failure;
      },
    });
    const transaction = database.transaction.bind(database);
    if (phase === "close")
      vi.spyOn(database, "transaction").mockImplementation((project, callback) =>
        transaction(project, (writer) => {
          const result = callback(writer);
          vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(() => {
            throw failure;
          });
          return result;
        }),
      );
    try {
      await expect(service.load_project({ path: project_path })).rejects.toMatchObject({
        code: "data.committed_sync_failed",
        public_details: { committed: true, action: "reload_project" },
      });
      await database.close_project(project_path);
      expect((await database.get_all_meta(project_path)).updated_at).not.toBe("before");
    } finally {
      vi.restoreAllMocks();
      await database.close();
    }
  });

  it("snapshot 只暴露 会话权威的加载态字段", async () => {
    const service = create_service({
      database: create_database(),
      session_state: create_session_state({
        loaded: true,
        projectPath: "E:/Project/demo.lg",
      }),
    });

    await expect(service.get_project_snapshot()).resolves.toEqual({
      project: {
        path: "E:/Project/demo.lg",
        loaded: true,
        languages: DEFAULT_PROJECT_LANGUAGE_SETTINGS,
      },
    });
  });

  it("任务 busy 时拒绝全部生命周期写且不改变会话或数据库", async () => {
    const temp_dir = create_temp_dir();
    const current_project_path = write_file(path.join(temp_dir, "current.lg"));
    const next_project_path = write_file(path.join(temp_dir, "next.lg"));
    const database = create_database();
    const session_state = create_session_state({
      loaded: true,
      projectPath: current_project_path,
    });
    const service = create_service({
      database,
      session_state,
      task_busy: true,
    });

    await expect(service.load_project({ path: next_project_path })).rejects.toThrow(
      expect.objectContaining({ code: "runtime.busy" }),
    );
    await expect(
      service.create_project_commit({
        path: path.join(temp_dir, "created.lg"),
        source_paths: [],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "runtime.busy" }));
    await expect(
      service.apply_task_input({
        quality_rules: [],
        translation_prompt: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "runtime.busy" }));
    await expect(service.unload_project()).rejects.toThrow(
      expect.objectContaining({ code: "runtime.busy" }),
    );

    expect(session_state.snapshot()).toEqual({
      loaded: true,
      projectPath: current_project_path,
    });
    expect(database.transaction).not.toHaveBeenCalled();
    expect(database.create_project).not.toHaveBeenCalled();
    expect(database.close_project).not.toHaveBeenCalled();
  });

  it("load 发布缓存热机事件并标记会话", async () => {
    const project_path = write_file(path.join(create_temp_dir(), "demo.lg"));
    const project_events: Array<Parameters<CacheLifecycleHandler>[0]> = [];
    const session_state = create_session_state();
    const service = create_service({
      database: create_database({
        meta: { mtool_optimizer_enable: true, skip_duplicate_source_text_enable: true },
      }),
      session_state,
      project_event_handler: (event) => {
        project_events.push(event);
      },
    });

    await expect(service.load_project({ path: project_path })).resolves.toEqual({
      project: { path: project_path, loaded: true, languages: DEFAULT_PROJECT_LANGUAGE_SETTINGS },
    });

    expect(session_state.snapshot()).toEqual({
      loaded: true,
      projectPath: project_path,
    });
    expect(project_events).toMatchObject([
      {
        projectPath: project_path,
      },
    ]);
  });

  it.each([true, false])("打开项目在缓存热机前协调同文件重复状态，开关为 %s", async (enabled) => {
    const project_path = path.join(create_temp_dir(), "duplicates.lg");
    const database = new ProjectDatabase("1.0.0");
    try {
      await database.create_project(project_path, "duplicates", (database) => {
        database.set_meta(project_path, "skip_duplicate_source_text_enable", enabled);
        database.set_meta(project_path, "mtool_optimizer_enable", true);
        database.set_items(project_path, [
          create_item({ id: 1, src: "同文", file_path: "a.txt", row: 99, status: "DUPLICATED" }),
          create_item({ id: 2, src: "同文", file_path: "a.txt", row: 0, status: "NONE" }),
          create_item({
            id: 3,
            src: "已译",
            file_path: "a.txt",
            dst: "保留甲",
            status: "PROCESSED",
          }),
          create_item({
            id: 4,
            src: "已译",
            file_path: "a.txt",
            dst: "保留乙",
            status: "PROCESSED",
          }),
          create_item({ id: 5, src: "同文", file_path: "a.txt", status: "EXCLUDED" }),
        ]);
      });
      const service = create_service({
        database,
        config: { mtool_optimizer_enable: true, skip_duplicate_source_text_enable: enabled },
        project_event_handler: async () => {
          expect((await database.get_all_items(project_path)).map((item) => item.status)).toEqual([
            "NONE",
            enabled ? "DUPLICATED" : "NONE",
            "PROCESSED",
            "PROCESSED",
            "EXCLUDED",
          ]);
          expect((await database.get_all_meta(project_path)).translation_extras).toMatchObject({
            total_line: enabled ? 3 : 4,
            processed_line: 2,
            error_line: 0,
            line: 2,
          });
        },
      });
      await service.load_project({ path: project_path });
      const items = await database.get_all_items(project_path);
      expect(items.slice(2, 4).map((item) => item.dst)).toEqual(["保留甲", "保留乙"]);
      await service.load_project({ path: project_path });
      expect(await database.get_all_items(project_path)).toEqual(items);
    } finally {
      await database.close();
    }
  });

  it("load 在内部缓存热机失败时阻断 loaded", async () => {
    const project_path = write_file(path.join(create_temp_dir(), "broken-cache.lg"));
    const session_state = create_session_state();
    const service = create_service({
      database: create_database(),
      session_state,
      project_event_handler: () => {
        throw new Error("热机失败");
      },
    });

    await expect(service.load_project({ path: project_path })).rejects.toThrow("热机失败");

    expect(session_state.snapshot()).toEqual({
      loaded: false,
      projectPath: "",
    });
  });

  it("打开工程保留项目语言，只在打开事务内对齐应用预过滤开关", async () => {
    const project_path = write_file(path.join(create_temp_dir(), "aligned.lg"));
    const database = create_database({
      meta: {
        source_language: "EN",
        target_language: "DE",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
      },
      asset_records: [{ path: "script.txt", sort_order: 0, file_type: "TXT" }],
      items: [
        create_item({ id: 1, file_path: "script.txt", file_type: "TXT", src: "こんにちは" }),
      ] as unknown as MutableJsonRecord[],
    });
    const service = create_service({ database, config: { mtool_optimizer_enable: false } });

    await expect(service.load_project({ path: project_path })).resolves.toEqual({
      project: {
        path: project_path,
        loaded: true,
        languages: { source_language: "EN", target_language: "DE" },
      },
      settings_alignment: {
        settings: { mtool_optimizer_enable: false, skip_duplicate_source_text_enable: true },
        changed: { mtool_optimizer_enable: true, skip_duplicate_source_text_enable: false },
      },
    });
    const meta_writes = vi.mocked(database.upsert_meta_entries).mock.calls.at(-1)?.[1];
    expect(meta_writes).toMatchObject({
      mtool_optimizer_enable: false,
      prefilter_config: { source_language: "EN", mtool_optimizer_enable: false },
    });
    expect(meta_writes).not.toHaveProperty("source_language");
    expect(meta_writes).not.toHaveProperty("target_language");
    // 英文源语言下日文原文被预过滤，打开事务只回写状态变化的条目。
    expect(database.patch_item_translation_fields).toHaveBeenCalledWith(project_path, [
      expect.objectContaining({
        item_id: 1,
        next: expect.objectContaining({ status: "LANGUAGE_SKIPPED" }),
      }),
    ]);
  });

  it("预过滤开关一致时打开工程不对齐也不改写设置", async () => {
    const project_path = write_file(path.join(create_temp_dir(), "same.lg"));
    const database = create_database({
      meta: {
        target_language: "KO",
        prefilter_config: {
          source_language: "EN",
          mtool_optimizer_enable: true,
          skip_duplicate_source_text_enable: true,
        },
      },
    });
    const service = create_service({ database });

    await expect(service.load_project({ path: project_path })).resolves.toEqual({
      project: {
        path: project_path,
        loaded: true,
        languages: { source_language: "EN", target_language: "KO" },
      },
    });
    expect(database.upsert_meta_entries).not.toHaveBeenCalled();
  });

  it("连续打开语言不同的工程时各自保留项目语言", async () => {
    const app_root = create_temp_dir();
    const source_path = write_file(path.join(app_root, "source", "script.txt"), "こんにちは");
    const database = new ProjectDatabase("1.0.0");
    const service = create_service({ app_root, database });
    const project_a = path.join(app_root, "a.lg");
    const project_b = path.join(app_root, "b.lg");
    try {
      await service.create_project_commit({
        source_paths: [source_path],
        path: project_a,
        languages: { source_language: "JA", target_language: "EN" },
      });
      await service.create_project_commit({
        source_paths: [source_path],
        path: project_b,
        languages: { source_language: "ALL", target_language: "KO" },
      });
      for (const [project_path, languages] of [
        [project_a, { source_language: "JA", target_language: "EN" }],
        [project_b, { source_language: "ALL", target_language: "KO" }],
        [project_a, { source_language: "JA", target_language: "EN" }],
      ] as const) {
        await expect(service.load_project({ path: project_path })).resolves.toMatchObject({
          project: { languages },
        });
        await expect(service.get_project_snapshot()).resolves.toMatchObject({
          project: { path: project_path, languages },
        });
      }
    } finally {
      await database.close();
    }
  });

  it("create-commit 拒绝非法初始语言且不创建工程", async () => {
    const database = create_database();
    const service = create_service({ database });
    await expect(
      service.create_project_commit({
        source_paths: [],
        path: path.join(create_temp_dir(), "invalid.lg"),
        languages: { source_language: "JA", target_language: "ALL" },
      }),
    ).rejects.toMatchObject({ code: "request.validation_failed" });
    expect(database.create_project).not.toHaveBeenCalled();
  });

  it("create-commit 按源路径、目标路径和所选语言生成新工程事实", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "created.lg");
    const source_path = write_file(path.join(app_root, "source", "script.txt"), "こんにちは");
    const database = new ProjectDatabase("1.0.0");
    const service = create_service({
      app_root,
      database,
      config: {
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
      },
    });

    try {
      await expect(
        service.create_project_commit({
          source_paths: [path.dirname(source_path)],
          path: project_path,
          languages: { source_language: "JA", target_language: "ZH" },
        }),
      ).resolves.toEqual({
        project: { path: project_path, loaded: true, languages: DEFAULT_PROJECT_LANGUAGE_SETTINGS },
      });

      expect(await database.get_all_asset_records(project_path)).toEqual([
        { path: path.join("source", "script.txt"), sort_order: 0, file_type: "TXT" },
      ]);
      expect(await database.get_all_items(project_path)).toMatchObject([
        {
          id: 1,
          file_path: path.join("source", "script.txt"),
          src: "こんにちは",
          status: "NONE",
        },
      ]);
      expect(await database.get_all_meta(project_path)).toMatchObject({
        source_language: "JA",
        target_language: "ZH",
        prefilter_config: {
          source_language: "JA",
          mtool_optimizer_enable: true,
          skip_duplicate_source_text_enable: true,
        },
      });
    } finally {
      await database.close();
    }
  });

  it("create-commit 目标工程已存在时追加时间戳写入新路径", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 3, 4, 5));
    const database = new ProjectDatabase("1.0.0");
    try {
      const app_root = create_temp_dir();
      const project_path = write_file(path.join(app_root, "created.lg"), "old-project");
      const resolved_project_path = path.join(app_root, "created_20260602_030405.lg");
      const source_path = write_file(path.join(app_root, "source", "script.txt"), "こんにちは");
      const service = create_service({
        app_root,
        database,
      });

      await expect(
        service.create_project_commit({
          source_paths: [path.dirname(source_path)],
          path: project_path,
        }),
      ).resolves.toEqual({
        project: {
          path: resolved_project_path,
          loaded: true,
          languages: DEFAULT_PROJECT_LANGUAGE_SETTINGS,
        },
      });

      expect(fs.readFileSync(project_path, "utf-8")).toBe("old-project");
      expect(fs.existsSync(resolved_project_path)).toBe(true);
    } finally {
      await database.close();
      vi.useRealTimers();
    }
  });

  it("create-commit 时间戳路径也存在时追加递增序号", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 3, 4, 5));
    const database = new ProjectDatabase("1.0.0");
    try {
      const app_root = create_temp_dir();
      const project_path = write_file(path.join(app_root, "created.lg"), "old-project");
      const timestamped_project_path = write_file(
        path.join(app_root, "created_20260602_030405.lg"),
        "old-timestamp",
      );
      const resolved_project_path = path.join(app_root, "created_20260602_030405_2.lg");
      const source_path = write_file(path.join(app_root, "source", "script.txt"), "こんにちは");
      const service = create_service({
        app_root,
        database,
      });

      await expect(
        service.create_project_commit({
          source_paths: [path.dirname(source_path)],
          path: project_path,
        }),
      ).resolves.toEqual({
        project: {
          path: resolved_project_path,
          loaded: true,
          languages: DEFAULT_PROJECT_LANGUAGE_SETTINGS,
        },
      });

      expect(fs.readFileSync(project_path, "utf-8")).toBe("old-project");
      expect(fs.readFileSync(timestamped_project_path, "utf-8")).toBe("old-timestamp");
      expect(fs.existsSync(resolved_project_path)).toBe(true);
    } finally {
      await database.close();
      vi.useRealTimers();
    }
  });

  it("create-commit 将默认预设内容、启用态和 revision 写入新工程", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "created-with-presets.lg");
    write_file(
      path.join(app_root, "builtin", "glossary", "preset", "base.json"),
      '[{"src":"魔力","dst":"Mana"}]',
    );
    write_file(
      path.join(app_root, "builtin", "text_preserve", "preset", "base.json"),
      '[{"src":"\\\\[[^\\\\]]+\\\\]"}]',
    );
    write_file(
      path.join(app_root, "builtin", "translation_prompt", "preset", "base.txt"),
      "翻译提示词",
    );
    const database = new ProjectDatabase("1.0.0");
    const service = create_service({
      app_root,
      database,
      config: {
        glossary_default_preset: "builtin:base.json",
        text_preserve_default_preset: "builtin:base.json",
        translation_custom_prompt_default_preset: "builtin:base.txt",
      },
    });

    try {
      await expect(
        service.create_project_commit({
          source_paths: [],
          path: project_path,
        }),
      ).resolves.toEqual({
        project: { path: project_path, loaded: true, languages: DEFAULT_PROJECT_LANGUAGE_SETTINGS },
      });

      expect(await database.get_rules(project_path, "glossary")).toEqual([
        {
          entry_id: expect.any(String),
          src: "魔力",
          dst: "Mana",
          info: "",
          case_sensitive: false,
        },
      ]);
      expect(await database.get_rules(project_path, "text_preserve")).toEqual([
        {
          entry_id: expect.any(String),
          src: "\\[[^\\]]+\\]",
          info: "",
        },
      ]);
      expect(await database.get_rule_text(project_path, "translation_prompt")).toBe("翻译提示词");
      expect(await database.get_all_meta(project_path)).toMatchObject({
        glossary_enable: true,
        text_preserve_mode: "custom",
        translation_prompt_enable: true,
        "quality_rule_revision.glossary": 1,
        "quality_rule_revision.text_preserve": 1,
        "quality_prompt_revision.translation": 1,
      });
    } finally {
      await database.close();
    }
  });

  it("create-commit 在单个默认预设读取失败时继续创建可用工程", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "created-with-missing-preset.lg");
    const database = new ProjectDatabase("1.0.0");
    const log_manager = create_log_manager();
    const service = create_service({
      app_root,
      database,
      log_manager,
      config: {
        glossary_default_preset: "builtin:missing.json",
      },
    });

    try {
      await expect(
        service.create_project_commit({
          source_paths: [],
          path: project_path,
        }),
      ).resolves.toEqual({
        project: { path: project_path, loaded: true, languages: DEFAULT_PROJECT_LANGUAGE_SETTINGS },
      });

      expect(await database.get_all_meta(project_path)).toMatchObject({
        text_preserve_mode: "smart",
      });
      expect(await database.get_all_meta(project_path)).not.toHaveProperty(
        "quality_rule_revision.glossary",
      );
      expect(log_manager.warning).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          context: expect.objectContaining({
            preset_directory: "glossary",
            virtual_id: "builtin:missing.json",
          }),
          source: "project-lifecycle",
        }),
      );
    } finally {
      await database.close();
    }
  });

  it("create-commit 拒绝旧前端最终事实字段", async () => {
    const app_root = create_temp_dir();
    const service = create_service({
      app_root,
      database: create_database(),
    });

    await expect(
      service.create_project_commit({
        source_paths: [],
        path: path.join(app_root, "legacy-payload.lg"),
        draft: { files: [], items: [] },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "request.validation_failed" }));
  });

  it.each(["json", "evb"])("create-commit 跳过 %s 失败来源并继续创建可用文件", async (kind) => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "partial-created.lg");
    const source_dir = path.join(app_root, "source");
    write_file(path.join(source_dir, "script.txt"), "こんにちは");
    const broken_json = write_file(
      path.join(source_dir, kind === "json" ? "broken.json" : "broken.exe"),
      "{",
    );
    if (kind === "evb") fs.writeFileSync(broken_json, evb_fixture(new Map()).subarray(0, -1));
    const database = new ProjectDatabase("1.0.0");
    const log_manager = create_log_manager();
    const service = create_service({
      app_root,
      database,
      log_manager,
    });

    try {
      await expect(
        service.create_project_commit({
          source_paths: [source_dir],
          path: project_path,
        }),
      ).resolves.toEqual({
        project: { path: project_path, loaded: true, languages: DEFAULT_PROJECT_LANGUAGE_SETTINGS },
        failed_files: [
          {
            source_path: broken_json,
            rel_path: kind === "json" ? path.join("source", "broken.json") : "broken.exe",
            filename: path.basename(broken_json),
            code: kind === "json" ? "file.parse_failed" : "file.io_failed",
            message: expect.any(String),
          },
        ],
      });

      expect(await database.get_all_asset_records(project_path)).toEqual([
        { path: path.join("source", "script.txt"), sort_order: 0, file_type: "TXT" },
      ]);
      expect(log_manager.warning).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ source: "project-lifecycle" }),
      );
    } finally {
      await database.close();
    }
  });

  it("create-commit 保存零条目错误脚本并记录诊断日志", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "scripts.lg");
    const game = path.join(app_root, "game");
    write_file(path.join(game, "data/System.json"), "{}");
    write_file(path.join(game, "js/rmmz_core.js"), "");
    const source = write_file(path.join(game, "js/plugins/bad.js"), "<test>");
    const database = new ProjectDatabase("1.0.0");
    const log_manager = create_log_manager();
    const service = create_service({ app_root, database, log_manager });
    try {
      const result = await service.create_project_commit({
        source_paths: [game],
        path: project_path,
      });
      expect(result["failed_files"]).toBeUndefined();
      const archive = await read_zip_fixture(
        (await database.read_asset_content(project_path, "game.rpgmaker"))!,
      );
      expect(zip_text(archive, "js/plugins/bad.js")).toEqual(fs.readFileSync(source, "utf8"));
      expect(await database.get_all_asset_records(project_path)).toMatchObject([
        { path: "game.rpgmaker", file_type: "RPGMAKER_MV_MZ" },
      ]);
      expect(await database.get_all_items(project_path)).toEqual([]);
      expect(log_manager.warning).toHaveBeenCalledWith(
        expect.stringContaining("bad.js"),
        expect.objectContaining({
          context: {
            warnings: [
              expect.objectContaining({
                code: "script_syntax_error",
                rel_path: "game.rpgmaker",
                internal_file_path: "js/plugins/bad.js",
              }),
            ],
          },
        }),
      );
    } finally {
      await database.close();
    }
  });

  it("create-commit 全部源文件解析失败时不创建工程并返回失败明细", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "all-failed.lg");
    const broken_json = write_file(path.join(app_root, "source", "broken.json"), "{");
    const database = new ProjectDatabase("1.0.0");
    const log_manager = create_log_manager();
    const service = create_service({
      app_root,
      database,
      log_manager,
    });

    try {
      await expect(
        service.create_project_commit({
          source_paths: [path.dirname(broken_json)],
          path: project_path,
        }),
      ).rejects.toMatchObject({
        code: "file.parse_failed",
        public_details: {
          failed_files: [
            {
              source_path: broken_json,
              rel_path: path.join("source", "broken.json"),
              filename: "broken.json",
              code: "file.parse_failed",
              message: expect.any(String),
            },
          ],
        },
      });

      expect(fs.existsSync(project_path)).toBe(false);
      expect(log_manager.warning).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ source: "project-lifecycle" }),
      );
    } finally {
      await database.close();
    }
  });

  it("高版本打开在业务写入前释放占用并保留当前会话，确认后可重试", async () => {
    const project_path = path.join(create_temp_dir(), "newer.lg");
    const database = new ProjectDatabase("1.0.0");
    const session_state = create_session_state({ loaded: true, projectPath: "current.lg" });
    const project_event_handler = vi.fn();
    const service = create_service({ database, session_state, project_event_handler });
    try {
      await database.create_project(project_path, "newer");
      await database.transaction(project_path, (writer) =>
        writer.set_meta(project_path, "target_app_version", "2.0.0"),
      );
      const before = fs.readFileSync(project_path);
      await expect(service.load_project({ path: project_path })).rejects.toMatchObject({
        code: "project.newer_app_version",
        public_details: { target_app_version: "2.0.0", current_app_version: "1.0.0" },
      });
      expect(session_state.snapshot()).toEqual({ loaded: true, projectPath: "current.lg" });
      expect(project_event_handler).not.toHaveBeenCalled();
      expect(fs.readFileSync(project_path)).toEqual(before);
      await service.load_project({ path: project_path, confirmed_target_app_version: "2.0.0" });
      expect(session_state.snapshot()).toEqual({ loaded: true, projectPath: project_path });
      expect((await database.get_all_meta(project_path)).target_app_version).toBe("2.0.0");
    } finally {
      await database.close();
    }
  });

  it("preview 在任务运行时读取另一工程的磁盘概览并保留当前会话", async () => {
    const project_path = path.join(create_temp_dir(), "preview.lg");
    const database = new ProjectDatabase("1.0.0");
    await database.create_project(project_path, "preview");
    const session_state = create_session_state({ loaded: true, projectPath: "current.lg" });
    const project_event_handler = vi.fn();
    const service = create_service({
      database,
      session_state,
      project_event_handler,
      task_busy: true,
    });
    try {
      expect(await service.get_project_preview({ path: project_path })).toMatchObject({
        preview: { file_paths: [], translation_stats: { total_items: 0 } },
      });
      expect(session_state.snapshot()).toEqual({ loaded: true, projectPath: "current.lg" });
      expect(project_event_handler).not.toHaveBeenCalled();
    } finally {
      await database.close();
    }
  });

  it("unload 先发布内部卸载事件，再清理会话和 database 缓存", async () => {
    const calls: string[] = [];
    const project_path = "E:/Project/demo.lg";
    const database = create_database({ calls });
    const service = create_service({
      database,
      project_event_handler: () => {
        calls.push("cache");
      },
      session_state: create_session_state({
        loaded: true,
        projectPath: project_path,
      }),
    });

    await expect(service.unload_project()).resolves.toEqual({
      project: {
        path: "",
        loaded: false,
      },
    });

    expect(calls).toEqual(["cache", "closeProject"]);
    expect(database.close_project).toHaveBeenCalledWith(project_path);
  });

  it("unload 未加载时不释放 database 缓存", async () => {
    const database = create_database();
    const service = create_service({
      database,
      session_state: create_session_state({ loaded: false, projectPath: "" }),
    });

    await service.unload_project();

    expect(database.close_project).not.toHaveBeenCalled();
  });

  // 每个用例独占临时目录，隔离工程和来源文件。
  function create_temp_dir(): string {
    const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-project-lifecycle-"));
    cleanup_paths.push(temp_dir);
    return temp_dir;
  }

  // 文件内容同时供来源解析和真实数据库场景使用。
  function write_file(file_path: string, content = "demo"): string {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, content, "utf-8");
    return file_path;
  }

  // 服务工厂保留真实 AppPathService，只替换数据库、设置、日志与事件边界。
  function create_service(options: {
    app_root?: string;
    database: ProjectDatabase;
    session_state?: ProjectSessionState;
    config?: MutableJsonRecord;
    log_manager?: LogManager & {
      info: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    };
    project_event_handler?: CacheLifecycleHandler;
    task_busy?: boolean;
  }): ProjectLifecycleService {
    const app_root = options.app_root ?? create_temp_dir();
    const project_event_handler = options.project_event_handler ?? vi.fn();
    let languages: ProjectLanguageSettings = DEFAULT_PROJECT_LANGUAGE_SETTINGS;
    return new ProjectLifecycleService(
      new GameDirectoryOperations(),
      options.database,
      create_runtime_gate(options.task_busy ?? false),
      options.session_state ?? create_session_state(),
      create_setting_service(options.config ?? {}),
      new AppPathService({
        appRoot: app_root,
        builtinRoot: path.join(app_root, "builtin"),
      }),
      options.log_manager ?? create_log_manager(),
      {
        installProject: (projectPath, snapshot) => {
          languages = snapshot.languages;
          return project_event_handler({ projectPath, snapshot });
        },
        clearProject: (projectPath) => project_event_handler({ projectPath: projectPath ?? "" }),
        languages: { readBlock: () => languages } as never,
      },
      new ProjectWriteStore(options.database, () => undefined, null),
      create_pdf_execution(),
    );
  }

  /** 用真实占用门禁验证生命周期命令的忙碌边界。 */
  function create_runtime_gate(busy: boolean): RuntimeOperationGate {
    const gate = new RuntimeOperationGate();
    if (busy) gate.begin_runtime("batch_translation");
    return gate;
  }

  // 数据库 fake 只提供无需真实持久化的生命周期场景所需读取面。
  function create_database(
    options: {
      meta?: MutableJsonRecord;
      items?: MutableJsonRecord[];
      asset_records?: Array<{ path: string; sort_order: number; file_type?: string }>;
      rule_text_by_type?: Record<string, string>;
      calls?: string[];
    } = {},
  ): TestProjectDatabase {
    const read_project_preview = vi.fn();
    const close_project = vi.fn(() => {
      options.calls?.push("closeProject");
    });
    return {
      read_project_preview,
      prepare: async () => {},
      async read<T>(_path: string, callback: (reader: ProjectDatabaseAccess) => T): Promise<T> {
        return callback(this as unknown as ProjectDatabaseAccess);
      },
      get_all_meta: vi.fn(() => options.meta ?? {}),
      get_all_items: vi.fn(() => options.items ?? []),
      get_rules: vi.fn(() => []),
      read_pdf_summaries: vi.fn(() => ({})),
      get_all_asset_records: vi.fn(() => options.asset_records ?? []),
      get_rule_text: vi.fn(
        (_project_path: string, rule_type: string) => options.rule_text_by_type?.[rule_type] ?? "",
      ),
      transaction: vi.fn(function (
        this: ProjectDatabaseAccess,
        _project_path: string,
        callback: (writer: ProjectDatabaseAccess) => unknown,
      ) {
        return callback(this);
      }),
      create_project: vi.fn((_project_path: string, _name: string, initialize?: () => void) =>
        initialize?.(),
      ),
      set_meta: vi.fn(),
      set_rules: vi.fn(),
      set_rule_text: vi.fn(),
      add_asset: vi.fn(),
      set_items: vi.fn(() => []),
      upsert_meta_entries: vi.fn(),
      patch_item_translation_fields: vi.fn(),
      close_project,
    } as unknown as TestProjectDatabase;
  }

  // 会话状态 helper 通过公开方法预置 loaded 快照，避免手写内部字段。
  function create_session_state(
    state: { loaded: boolean; projectPath: string } = {
      loaded: false,
      projectPath: "",
    },
  ): ProjectSessionState {
    const session_state = new ProjectSessionState();
    if (state.loaded) {
      session_state.mark_loaded(state.projectPath);
    }
    return session_state;
  }

  // 设置服务 fake 合并项目默认值，确保 create-commit 用例只声明场景差异。
  function create_setting_service(config: MutableJsonRecord) {
    return {
      read_setting: vi.fn(() => ({
        app_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
        ...config,
      })),
    } as unknown as AppSettingService;
  }

  // 日志 fake 用于断言生命周期诊断，不参与业务状态计算。
  function create_log_manager() {
    return {
      info: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
    } as unknown as LogManager & {
      info: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
      warning: ReturnType<typeof vi.fn>;
    };
  }
});

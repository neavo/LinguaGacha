import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSessionState } from "./project-session-state";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectEventHandler } from "../project/project-events";
import { ProjectDatabase } from "../database/database-operations";
import type { MutableJsonRecord } from "../../domain/json";
import type { LogManager } from "../log/log-manager";
import type { AppSettingService } from "../app/app-setting-service";
import { AppPathService } from "../app/app-path-service";
import { ProjectLifecycleService } from "./project-lifecycle-service";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectWriteStore } from "./project-write-store";

type TestProjectDatabase = ProjectDatabase & {
  get_project_summary: ReturnType<typeof vi.fn>;
  close_project: ReturnType<typeof vi.fn>;
  create_project: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

describe("ProjectLifecycleService", () => {
  const cleanup_paths: string[] = []; // 生命周期测试会创建真实临时文件，统一登记清理避免污染用户工作区

  afterEach(() => {
    while (cleanup_paths.length > 0) {
      fs.rmSync(cleanup_paths.pop() ?? "", { force: true, recursive: true });
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

    await expect(service.load_project({ path: next_project_path })).rejects.toThrow("runtime.busy");
    await expect(
      service.create_project_commit({
        path: path.join(temp_dir, "created.lg"),
        source_paths: [],
      }),
    ).rejects.toThrow("runtime.busy");
    await expect(
      service.apply_task_input({
        quality_rules: [],
        prompts: [],
      }),
    ).rejects.toThrow("runtime.busy");
    await expect(service.unload_project()).rejects.toThrow("runtime.busy");

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
    const project_events: Array<Parameters<ProjectEventHandler>[0]> = [];
    const session_state = create_session_state();
    const service = create_service({
      database: create_database(),
      session_state,
      project_event_handler: (event) => {
        project_events.push(event);
      },
    });

    await expect(service.load_project({ path: project_path })).resolves.toEqual({
      project: { path: project_path, loaded: true },
    });

    expect(session_state.snapshot()).toEqual({
      loaded: true,
      projectPath: project_path,
    });
    expect(project_events).toMatchObject([
      {
        type: "project.opened_for_cache",
        projectPath: project_path,
      },
    ]);
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

  it("open-preview 仅目标语言变化时返回 settings_only", () => {
    const project_path = write_file(path.join(create_temp_dir(), "settings-only.lg"));
    const service = create_service({
      database: create_database({
        meta: {
          source_language: "JA",
          target_language: "EN",
          mtool_optimizer_enable: true,
          skip_duplicate_source_text_enable: true,
        },
      }),
      config: {
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
      },
    });

    expect(service.get_open_alignment_preview({ path: project_path })).toEqual({
      preview: {
        action: "settings_only",
        project_path,
        project_settings: {
          source_language: "JA",
          target_language: "EN",
          mtool_optimizer_enable: true,
          skip_duplicate_source_text_enable: true,
        },
        current_settings: {
          source_language: "JA",
          target_language: "ZH",
          mtool_optimizer_enable: true,
          skip_duplicate_source_text_enable: true,
        },
        changed: {
          source_language: false,
          target_language: true,
          mtool_optimizer_enable: false,
          skip_duplicate_source_text_enable: false,
        },
        section_revisions: null,
      },
    });
  });

  it("open-preview 在源语言或预过滤字段变化时只返回 section revision 依赖", () => {
    const project_path = write_file(path.join(create_temp_dir(), "prefilter.lg"));
    const service = create_service({
      database: create_database({
        meta: {
          source_language: "EN",
          target_language: "ZH",
          project_runtime_revision: null,
          "project_runtime_revision.files": 2,
          "project_runtime_revision.items": 3,
          "project_runtime_revision.analysis": 4,
        },
        asset_records: [{ path: "script.txt", sort_order: 0 }],
        items: [
          {
            id: 1,
            file_path: "script.txt",
            file_type: "TXT",
            src: "Hello",
            status: "NONE",
          },
        ],
      }),
      config: {
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
      },
    });

    const result = service.get_open_alignment_preview({ path: project_path });

    expect(result["preview"]).toEqual(
      expect.objectContaining({
        action: "prefiltered_items",
        section_revisions: { files: 2, items: 3, analysis: 4 },
      }),
    );
  });

  it("create-commit 只凭源路径、目标路径和设置镜像生成新工程事实", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "created.lg");
    const source_path = write_file(path.join(app_root, "source", "script.txt"), "こんにちは");
    const database = new ProjectDatabase();
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
          project_settings: {
            source_language: "JA",
            target_language: "ZH",
            mtool_optimizer_enable: true,
            skip_duplicate_source_text_enable: true,
          },
        }),
      ).resolves.toEqual({ project: { path: project_path, loaded: true } });

      expect(database.get_all_asset_records(project_path)).toEqual([
        { path: path.join("source", "script.txt"), sort_order: 0 },
      ]);
      expect(database.get_all_items(project_path)).toMatchObject([
        {
          id: 1,
          file_path: path.join("source", "script.txt"),
          src: "こんにちは",
          status: "NONE",
        },
      ]);
      expect(database.get_all_meta(project_path)).toMatchObject({
        source_language: "JA",
        target_language: "ZH",
        prefilter_config: {
          source_language: "JA",
          mtool_optimizer_enable: true,
          skip_duplicate_source_text_enable: true,
        },
        analysis_candidate_count: 0,
      });
    } finally {
      database.close();
    }
  });

  it("create-commit 目标工程已存在时追加时间戳写入新路径", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 3, 4, 5));
    const database = new ProjectDatabase();
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
          project_settings: {},
        }),
      ).resolves.toEqual({
        project: { path: resolved_project_path, loaded: true },
      });

      expect(fs.readFileSync(project_path, "utf-8")).toBe("old-project");
      expect(fs.existsSync(resolved_project_path)).toBe(true);
    } finally {
      database.close();
      vi.useRealTimers();
    }
  });

  it("create-commit 时间戳路径也存在时追加递增序号", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 3, 4, 5));
    const database = new ProjectDatabase();
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
          project_settings: {},
        }),
      ).resolves.toEqual({
        project: { path: resolved_project_path, loaded: true },
      });

      expect(fs.readFileSync(project_path, "utf-8")).toBe("old-project");
      expect(fs.readFileSync(timestamped_project_path, "utf-8")).toBe("old-timestamp");
      expect(fs.existsSync(resolved_project_path)).toBe(true);
    } finally {
      database.close();
      vi.useRealTimers();
    }
  });

  it("create-commit 将默认预设内容、启用态和 revision 写入新工程", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "created-with-presets.lg");
    write_file(
      path.join(app_root, "resource", "glossary", "preset", "base.json"),
      '[{"src":"魔力","dst":"Mana"}]',
    );
    write_file(
      path.join(app_root, "resource", "text_preserve", "preset", "base.json"),
      '[{"src":"\\\\[[^\\\\]]+\\\\]"}]',
    );
    write_file(
      path.join(app_root, "resource", "translation_prompt", "preset", "base.txt"),
      "翻译提示词",
    );
    const database = new ProjectDatabase();
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
          project_settings: {},
        }),
      ).resolves.toEqual({ project: { path: project_path, loaded: true } });

      expect(database.get_rules(project_path, "glossary")).toEqual([
        {
          entry_id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{5}$/u),
          src: "魔力",
          dst: "Mana",
          info: "",
          case_sensitive: false,
        },
      ]);
      expect(database.get_rules(project_path, "text_preserve")).toEqual([
        {
          entry_id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{5}$/u),
          src: "\\[[^\\]]+\\]",
          info: "",
        },
      ]);
      expect(database.get_rule_text(project_path, "translation_prompt")).toBe("翻译提示词");
      expect(database.get_all_meta(project_path)).toMatchObject({
        glossary_enable: true,
        text_preserve_mode: "custom",
        translation_prompt_enable: true,
        "quality_rule_revision.glossary": 1,
        "quality_rule_revision.text_preserve": 1,
        "quality_prompt_revision.translation": 1,
      });
    } finally {
      database.close();
    }
  });

  it("create-commit 在单个默认预设读取失败时继续创建可用工程", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "created-with-missing-preset.lg");
    const database = new ProjectDatabase();
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
          project_settings: {},
        }),
      ).resolves.toEqual({ project: { path: project_path, loaded: true } });

      expect(database.get_all_meta(project_path)).toMatchObject({ text_preserve_mode: "smart" });
      expect(database.get_all_meta(project_path)).not.toHaveProperty(
        "quality_rule_revision.glossary",
      );
      expect(log_manager.warning).toHaveBeenCalledWith(
        "默认质量规则预设加载失败 …",
        expect.objectContaining({
          context: expect.objectContaining({
            preset_directory: "glossary",
            virtual_id: "builtin:missing.json",
          }),
          source: "project-lifecycle",
        }),
      );
    } finally {
      database.close();
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
    ).rejects.toThrow("request.validation_failed");
  });

  it("create-commit 跳过解析失败源文件并继续创建可用文件", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "partial-created.lg");
    const source_dir = path.join(app_root, "source");
    write_file(path.join(source_dir, "script.txt"), "こんにちは");
    const broken_json = write_file(path.join(source_dir, "broken.json"), "{");
    const database = new ProjectDatabase();
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
          project_settings: {},
        }),
      ).resolves.toEqual({
        project: { path: project_path, loaded: true },
        failed_files: [
          {
            source_path: broken_json,
            rel_path: path.join("source", "broken.json"),
            filename: "broken.json",
            code: "file.parse_failed",
          },
        ],
      });

      expect(database.get_all_asset_records(project_path)).toEqual([
        { path: path.join("source", "script.txt"), sort_order: 0 },
      ]);
      expect(log_manager.warning).toHaveBeenCalledWith(
        "broken.json - 文件内容解析失败 …",
        expect.objectContaining({ source: "project-lifecycle" }),
      );
    } finally {
      database.close();
    }
  });

  it("create-commit 全部源文件解析失败时不创建工程并返回失败明细", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "all-failed.lg");
    const broken_json = write_file(path.join(app_root, "source", "broken.json"), "{");
    const database = new ProjectDatabase();
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
          project_settings: {},
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
            },
          ],
        },
      });

      expect(fs.existsSync(project_path)).toBe(false);
      expect(log_manager.warning).toHaveBeenCalledWith(
        "broken.json - 文件内容解析失败 …",
        expect.objectContaining({ source: "project-lifecycle" }),
      );
    } finally {
      database.close();
    }
  });

  it("source-files 按源路径顺序收集支持格式并去重", () => {
    const root = create_temp_dir();
    const source_a = path.join(root, "source-a");
    const source_b = path.join(root, "source-b");
    fs.mkdirSync(path.join(source_a, "nested"), { recursive: true });
    fs.mkdirSync(source_b, { recursive: true });
    const first_txt = write_file(path.join(source_a, "b.TXT"));
    const second_md = write_file(path.join(source_a, "nested", "a.md"));
    const ignored = write_file(path.join(source_a, "ignore.bin"));
    const third_json = write_file(path.join(source_b, "c.json"));
    const service = create_service({ database: create_database() });

    const result = service.collect_source_files({
      source_paths: ["", source_a, first_txt, ignored, source_b, source_a],
    });

    expect(result).toEqual({
      source_files: [first_txt, second_md, third_json],
    });
  });

  it("preview 从 database summary 收窄为公开摘要载荷", () => {
    const project_path = write_file(path.join(create_temp_dir(), "demo.lg"));
    const database = create_database({
      summary: {
        name: "demo",
        source_language: "JA",
        target_language: "ZH",
        file_count: 2,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        translation_stats: {
          total_items: 10,
          completed_count: 4,
          failed_count: 1,
          pending_count: 3,
          skipped_count: 2,
          completion_percent: 60,
        },
        hidden_field: "不会外泄",
      },
    });
    const service = create_service({ database });

    expect(service.get_project_preview({ path: project_path })).toEqual({
      preview: {
        path: project_path,
        name: "demo",
        source_language: "JA",
        target_language: "ZH",
        file_count: 2,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        translation_stats: {
          total_items: 10,
          completed_count: 4,
          failed_count: 1,
          pending_count: 3,
          skipped_count: 2,
          completion_percent: 60,
        },
      },
    });
  });

  it("preview 在project.not_found时抛出 ENOENT", () => {
    const service = create_service({ database: create_database() });

    expect(() =>
      service.get_project_preview({
        path: path.join(create_temp_dir(), "missing.lg"),
      }),
    ).toThrow("project.not_found");
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

  // 每个用例使用独立临时目录，覆盖项目文件存在性判断且不污染工作区。
  function create_temp_dir(): string {
    const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-project-lifecycle-"));
    cleanup_paths.push(temp_dir);
    return temp_dir;
  }

  // 生命周期服务通过真实文件存在性判断工程路径，测试文件写入集中走这个 helper。
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
    project_event_handler?: ProjectEventHandler;
    task_busy?: boolean;
  }): ProjectLifecycleService {
    const app_root = options.app_root ?? create_temp_dir();
    const project_event_handler = options.project_event_handler ?? vi.fn();
    return new ProjectLifecycleService(
      options.database,
      create_runtime_gate(options.task_busy ?? false),
      options.session_state ?? create_session_state(),
      create_setting_service(options.config ?? {}),
      new AppPathService({ appRoot: app_root }),
      options.log_manager ?? create_log_manager(),
      project_event_handler,
      new ProjectWriteStore(options.database, project_event_handler, null),
    );
  }

  function create_runtime_gate(busy: boolean): RuntimeOperationGate {
    const gate = new RuntimeOperationGate();
    if (busy) gate.begin_runtime("task");
    return gate;
  }

  // 数据库 fake 只提供无需真实持久化的生命周期场景所需读取面。
  function create_database(
    options: {
      summary?: MutableJsonRecord;
      meta?: MutableJsonRecord;
      items?: MutableJsonRecord[];
      asset_records?: Array<{ path: string; sort_order: number }>;
      rule_text_by_type?: Record<string, string>;
      calls?: string[];
    } = {},
  ): TestProjectDatabase {
    const get_project_summary = vi.fn(() => options.summary ?? {});
    const close_project = vi.fn(() => {
      options.calls?.push("closeProject");
    });
    return {
      get_project_summary,
      get_all_meta: vi.fn(() => options.meta ?? {}),
      get_all_items: vi.fn(() => options.items ?? []),
      get_all_asset_records: vi.fn(() => options.asset_records ?? []),
      get_rule_text: vi.fn(
        (_project_path: string, rule_type: string) => options.rule_text_by_type?.[rule_type] ?? "",
      ),
      transaction: vi.fn((_project_path: string, callback: () => unknown) => callback()),
      create_project: vi.fn((_project_path: string, _name: string, initialize?: () => void) =>
        initialize?.(),
      ),
      set_meta: vi.fn(),
      set_rules: vi.fn(),
      set_rule_text: vi.fn(),
      add_asset_from_source: vi.fn(),
      set_items: vi.fn(() => []),
      upsert_meta_entries: vi.fn(),
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
        source_language: "JA",
        target_language: "ZH",
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

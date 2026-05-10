import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import type { LogManager } from "../log/log-manager";
import type { ConfigService } from "../service/config-service";
import { AppPathService } from "../service/path-service";
import { JsonTool } from "../../shared/utils/json-tool";
import { ProjectLifecycleService } from "./project-lifecycle-service";
import { ProjectSessionState } from "./project-session-state";

type MutableJsonRecord = Record<string, DatabaseJsonValue>;

describe("ProjectLifecycleService", () => {
  // 生命周期测试会创建真实临时文件，统一登记清理避免污染用户工作区。
  const cleanup_paths: string[] = [];

  afterEach(() => {
    while (cleanup_paths.length > 0) {
      fs.rmSync(cleanup_paths.pop() ?? "", { force: true, recursive: true });
    }
  });

  it("snapshot 只暴露 TS 会话权威的加载态字段", async () => {
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

  it("load 写入打开期兼容迁移并标记 TS 会话", async () => {
    const project_path = write_file(path.join(create_temp_dir(), "legacy.lg"));
    const transaction_calls: DatabaseOperation[][] = [];
    const database = create_database({
      meta: {
        text_preserve_enable: true,
      },
      rule_text_by_name: {
        CUSTOM_PROMPT_ZH: "旧中文提示词",
      },
      transaction_calls,
    });
    const session_state = create_session_state();
    const service = create_service({ database, session_state });

    await expect(service.load_project({ path: project_path })).resolves.toEqual({
      project: { path: project_path, loaded: true },
    });

    expect(transaction_calls[0]).toEqual([
      expect.objectContaining({
        name: "setMeta",
        args: expect.objectContaining({ key: "updated_at", projectPath: project_path }),
      }),
      {
        name: "setMeta",
        args: { projectPath: project_path, key: "text_preserve_mode", value: "custom" },
      },
      {
        name: "setRuleText",
        args: {
          projectPath: project_path,
          ruleType: "translation_prompt",
          text: "旧中文提示词",
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: project_path,
          key: "translation_prompt_legacy_migrated",
          value: true,
        },
      },
    ]);
    expect(session_state.snapshot()).toEqual({ loaded: true, projectPath: project_path });
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
        draft: null,
      },
    });
  });

  it("open-preview 在源语言或预过滤字段变化时返回草稿和 section revision", () => {
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
        draft: {
          files: [{ rel_path: "script.txt", file_type: "TXT", sort_index: 0 }],
          items: [
            {
              id: 1,
              file_path: "script.txt",
              file_type: "TXT",
              src: "Hello",
              status: "NONE",
            },
          ],
          section_revisions: { files: 2, items: 3, analysis: 4 },
        },
      }),
    );
  });

  it("create-commit 写入新工程草稿、默认预设和项目设置后复用 load", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "created.lg");
    const source_path = write_file(path.join(app_root, "source", "script.txt"));
    write_file(
      path.join(app_root, "resource", "glossary", "preset", "base.json"),
      JsonTool.stringifyStrict([{ src: "勇者", dst: "Hero" }]),
    );
    write_file(
      path.join(app_root, "resource", "translation_prompt", "preset", "base.txt"),
      "翻译提示词",
    );
    const transaction_calls: DatabaseOperation[][] = [];
    const database = create_database({ transaction_calls, create_project_files: true });
    const log_manager = create_log_manager();
    const service = create_service({
      app_root,
      database,
      log_manager,
      config: {
        glossary_default_preset: "builtin:base.json",
        translation_custom_prompt_default_preset: "builtin:base.txt",
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
      },
    });

    await expect(
      service.create_project_commit({
        source_paths: [path.dirname(source_path)],
        path: project_path,
        draft: {
          files: [{ rel_path: "script.txt", source_path, sort_index: 0 }],
          items: [
            {
              id: 1,
              file_path: "script.txt",
              file_type: "TXT",
              row: 1,
              src: "原文",
              dst: "",
              status: "NONE",
            },
          ],
        },
        project_settings: {
          source_language: "JA",
          target_language: "ZH",
          mtool_optimizer_enable: true,
          skip_duplicate_source_text_enable: true,
        },
        translation_extras: { total_line: 1 },
        prefilter_config: {},
      }),
    ).resolves.toEqual({ project: { path: project_path, loaded: true } });

    expect(transaction_calls[0]).toEqual([
      {
        name: "createProject",
        args: { projectPath: project_path, name: "source" },
      },
      {
        name: "setMeta",
        args: { projectPath: project_path, key: "text_preserve_mode", value: "smart" },
      },
      {
        name: "setRules",
        args: {
          projectPath: project_path,
          ruleType: "glossary",
          rules: [{ src: "勇者", dst: "Hero" }],
        },
      },
      {
        name: "setMeta",
        args: { projectPath: project_path, key: "glossary_enable", value: true },
      },
      {
        name: "setRuleText",
        args: {
          projectPath: project_path,
          ruleType: "translation_prompt",
          text: "翻译提示词",
        },
      },
      {
        name: "setMeta",
        args: { projectPath: project_path, key: "translation_prompt_enable", value: true },
      },
      {
        name: "addAssetFromSource",
        args: {
          projectPath: project_path,
          path: "script.txt",
          sourcePath: source_path,
          sortOrder: 0,
        },
      },
      {
        name: "setItems",
        args: {
          projectPath: project_path,
          items: [
            {
              id: 1,
              file_path: "script.txt",
              file_type: "TXT",
              row: 1,
              src: "原文",
              dst: "",
              name_src: null,
              name_dst: null,
              extra_field: "",
              tag: "",
              text_type: "NONE",
              status: "NONE",
              retry_count: 0,
            },
          ],
        },
      },
      {
        name: "upsertMetaEntries",
        args: {
          projectPath: project_path,
          meta: {
            source_language: "JA",
            target_language: "ZH",
            mtool_optimizer_enable: true,
            skip_duplicate_source_text_enable: true,
            prefilter_config: {
              source_language: "JA",
              mtool_optimizer_enable: true,
              skip_duplicate_source_text_enable: true,
            },
            translation_extras: { total_line: 1 },
            analysis_extras: {},
            analysis_candidate_count: 0,
          },
        },
      },
    ]);
    expect(log_manager.info).toHaveBeenCalledWith("已自动加载默认预设：术语表 | 翻译提示词 …", {
      source: "ts-project-lifecycle",
    });
  });

  it("create-commit 默认预设读取失败只记录日志并继续创建", async () => {
    const app_root = create_temp_dir();
    const project_path = path.join(app_root, "created-with-broken-preset.lg");
    const transaction_calls: DatabaseOperation[][] = [];
    const log_manager = create_log_manager();
    const service = create_service({
      app_root,
      database: create_database({ transaction_calls, create_project_files: true }),
      log_manager,
      config: {
        glossary_default_preset: "builtin:missing.json",
      },
    });

    await service.create_project_commit({
      source_paths: [],
      path: project_path,
      draft: { files: [], items: [] },
      project_settings: {},
      translation_extras: {},
      prefilter_config: {},
    });

    expect(transaction_calls[0]?.map((operation) => operation.name)).toContain("createProject");
    expect(log_manager.error).toHaveBeenCalledWith(
      "默认质量规则预设加载失败",
      expect.objectContaining({
        context: { preset_dir_name: "glossary", virtual_id: "builtin:missing.json" },
        source: "ts-project-lifecycle",
      }),
    );
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
    expect(database.execute).toHaveBeenCalledWith({
      name: "getProjectSummary",
      args: { projectPath: project_path },
    });
  });

  it("preview 在工程文件不存在时抛出 ENOENT", () => {
    const service = create_service({ database: create_database() });

    expect(() =>
      service.get_project_preview({ path: path.join(create_temp_dir(), "missing.lg") }),
    ).toThrow("工程文件不存在");
  });

  it("unload 清理 TS 会话并释放旧工程 database 缓存", async () => {
    const calls: string[] = [];
    const project_path = "E:/Project/demo.lg";
    const database = create_database({ calls });
    const service = create_service({
      database,
      session_state: create_session_state({ loaded: true, projectPath: project_path }),
    });

    await expect(service.unload_project()).resolves.toEqual({
      project: {
        path: "",
        loaded: false,
      },
    });

    expect(calls).toEqual(["closeProject"]);
    expect(database.execute).toHaveBeenCalledWith({
      name: "closeProject",
      args: { projectPath: project_path },
    });
  });

  it("unload 未加载时不释放 database 缓存", async () => {
    const database = create_database();
    const service = create_service({
      database,
      session_state: create_session_state({ loaded: false, projectPath: "" }),
    });

    await service.unload_project();

    expect(database.execute).not.toHaveBeenCalled();
  });

  function create_temp_dir(): string {
    const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-project-lifecycle-"));
    cleanup_paths.push(temp_dir);
    return temp_dir;
  }

  function write_file(file_path: string, content = "demo"): string {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, content, "utf-8");
    return file_path;
  }

  function create_service(options: {
    app_root?: string;
    database: ProjectDatabase & {
      execute: ReturnType<typeof vi.fn>;
      execute_transaction?: ReturnType<typeof vi.fn>;
    };
    session_state?: ProjectSessionState;
    config?: MutableJsonRecord;
    log_manager?: LogManager & {
      info: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    };
  }): ProjectLifecycleService {
    const app_root = options.app_root ?? create_temp_dir();
    return new ProjectLifecycleService(
      options.database,
      options.session_state ?? create_session_state(),
      create_config_service(options.config ?? {}),
      new AppPathService({ appRoot: app_root }),
      options.log_manager ?? create_log_manager(),
    );
  }

  function create_database(
    options: {
      summary?: MutableJsonRecord;
      meta?: MutableJsonRecord;
      items?: MutableJsonRecord[];
      asset_records?: Array<{ path: string; sort_order: number }>;
      rule_text_by_type?: Record<string, string>;
      rule_text_by_name?: Record<string, string>;
      transaction_calls?: DatabaseOperation[][];
      calls?: string[];
      create_project_files?: boolean;
    } = {},
  ) {
    const execute = vi.fn((operation: DatabaseOperation) => {
      options.calls?.push(operation.name);
      if (operation.name === "getProjectSummary") {
        return options.summary ?? {};
      }
      if (operation.name === "getAllMeta") {
        return options.meta ?? {};
      }
      if (operation.name === "getAllItems") {
        return options.items ?? [];
      }
      if (operation.name === "getAllAssetRecords") {
        return options.asset_records ?? [];
      }
      if (operation.name === "getRuleText") {
        const rule_type = String(operation.args?.["ruleType"] ?? "");
        return options.rule_text_by_type?.[rule_type] ?? "";
      }
      if (operation.name === "getRuleTextByName") {
        const rule_type_name = String(operation.args?.["ruleTypeName"] ?? "");
        return options.rule_text_by_name?.[rule_type_name] ?? "";
      }
      return null;
    });
    const execute_transaction = vi.fn((operations: DatabaseOperation[]) => {
      options.transaction_calls?.push(operations);
      if (options.create_project_files) {
        const create_project = operations.find((operation) => operation.name === "createProject");
        const project_path = String(create_project?.args?.["projectPath"] ?? "");
        if (project_path !== "") {
          write_file(project_path, "");
        }
      }
      return null;
    });
    return {
      execute,
      execute_transaction,
    } as unknown as ProjectDatabase & {
      execute: ReturnType<typeof vi.fn>;
      execute_transaction: ReturnType<typeof vi.fn>;
    };
  }

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

  function create_config_service(config: MutableJsonRecord) {
    return {
      load_config: vi.fn(() => ({
        app_language: "ZH",
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
        ...config,
      })),
    } as unknown as ConfigService;
  }

  function create_log_manager() {
    return {
      info: vi.fn(),
      error: vi.fn(),
    } as unknown as LogManager & {
      info: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    };
  }
});

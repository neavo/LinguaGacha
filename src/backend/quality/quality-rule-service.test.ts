import { adapt_project_change } from "../project/project-write-event-adapter";
import type { ProjectCommittedChange } from "../project/project-committed-change";
import { create_empty_quality_rule_block } from "../project/project-data-reader";
import { NativeFs } from "../../native/native-fs";
import { AppSettingService } from "../app/app-setting-service";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import type { JsonRecord } from "../../domain/json";
import { ProjectWriteStore } from "../project/project-write-store";

import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import { AppPathService } from "../app/app-path-service";
import type { CacheReadPort } from "../cache/cache-types";
import { QualityRuleService } from "./quality-rule-service";
import type { ProjectChangeEvent } from "../../shared/project-event";

describe("QualityRuleService", () => {
  it("用户预设删除等待磁盘完成，内置预设继续拒绝删除", async () => {
    const { service } = create_service();
    service.save_rule_preset({ rule_type: "glossary", name: "delete-fixture", entries: [] });
    const result = await service.delete_rule_preset({
      rule_type: "glossary",
      virtual_id: "user:delete-fixture.json",
    });
    expect(result.user_presets).toEqual([]);
    await expect(
      service.delete_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:delete-fixture.json",
      }),
    ).rejects.toMatchObject({ code: "request.validation_failed" });
  });
  it("重命名和删除默认预设时同步持久化默认引用并返回同一快照", async () => {
    const { service, settings } = create_service();
    service.save_rule_preset({ rule_type: "glossary", name: "old", entries: [] });
    settings.update_app_settings({ glossary_default_preset: "user:old.json" });
    const renamed = service.rename_rule_preset({
      rule_type: "glossary",
      virtual_id: "user:old.json",
      new_name: "new",
    });
    expect(renamed.user_presets.map((item) => item.virtual_id)).toEqual(["user:new.json"]);
    expect(renamed.settings.glossary_default_preset).toBe("user:new.json");
    const deleted = await service.delete_rule_preset({
      rule_type: "glossary",
      virtual_id: "user:new.json",
    });
    expect(deleted.user_presets).toEqual([]);
    expect(deleted.settings.glossary_default_preset).toBe("");
    expect(settings.read_setting().glossary_default_preset).toBe("");
  });

  it.each(["rename", "delete"] as const)(
    "%s 的设置写入失败时恢复原预设文件与默认引用",
    async (operation) => {
      const { service, settings } = create_service();
      service.save_rule_preset({ rule_type: "text_preserve", name: "old", entries: [] });
      settings.update_app_settings({ text_preserve_default_preset: "user:old.json" });
      vi.spyOn(settings, "update_app_settings").mockImplementationOnce(() => {
        throw new Error("disk full");
      });
      const request = { rule_type: "text_preserve", virtual_id: "user:old.json", new_name: "new" };
      await expect(
        Promise.resolve().then(() =>
          operation === "rename"
            ? service.rename_rule_preset(request)
            : service.delete_rule_preset(request),
        ),
      ).rejects.toThrow("disk full");
      expect(
        service.list_rule_presets(request).user_presets.map((item) => item.virtual_id),
      ).toEqual(["user:old.json"]);
      expect(service.read_rule_preset(request).entries).toEqual([]);
      expect(settings.read_setting().text_preserve_default_preset).toBe("user:old.json");
    },
  );

  it("暂存文件清理失败保留提交事实和期间更新的默认设置", async () => {
    const { service, settings, native_fs } = create_service();
    service.save_rule_preset({ rule_type: "glossary", name: "old", entries: [] });
    settings.update_app_settings({ glossary_default_preset: "user:old.json" });
    vi.spyOn(native_fs, "remove_async").mockImplementationOnce(async () => {
      settings.update_app_settings({ glossary_default_preset: "user:other.json" });
      throw new Error("cleanup failed");
    });
    await expect(
      service.delete_rule_preset({ rule_type: "glossary", virtual_id: "user:old.json" }),
    ).rejects.toMatchObject({ code: "data.committed_sync_failed" });
    expect(service.list_rule_presets({ rule_type: "glossary" }).user_presets).toEqual([]);
    expect(settings.read_setting().glossary_default_preset).toBe("user:other.json");
  });

  const cleanup_paths: string[] = [];
  const cleanup_databases: ProjectDatabase[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (cleanup_databases.length > 0) {
      cleanup_databases.pop()?.close();
    }
    while (cleanup_paths.length > 0) {
      const target_path = cleanup_paths.pop();
      if (target_path !== undefined) {
        fs.rmSync(target_path, { force: true, recursive: true });
      }
    }
  });

  it("读取质量规则预设时兼容 UTF-8 BOM 且保持严格 JSON", () => {
    const { service, app_root } = create_service();
    const preset_dir = path.join(app_root, "builtin", "glossary", "preset");
    fs.mkdirSync(preset_dir, { recursive: true });
    fs.writeFileSync(path.join(preset_dir, "demo.json"), '\uFEFF[{"src":"A","dst":"甲"}]', "utf-8");

    expect(
      service.read_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:demo.json",
      }),
    ).toEqual({
      entries: [
        {
          entry_id: expect.any(String),
          src: "A",
          dst: "甲",
          info: "",
          case_sensitive: false,
        },
      ],
    });
  });

  it("读取 text_preserve 内置预设时使用质量规则预设目录", () => {
    const { service, app_root } = create_service();
    const preset_dir = path.join(app_root, "builtin", "text_preserve", "preset"); // text_preserve 复用质量规则预设目录解析，避免简繁转换页再走专用接口
    fs.mkdirSync(preset_dir, { recursive: true });
    fs.writeFileSync(
      path.join(preset_dir, "renpy.json"),
      '[{"src":"\\\\[[^\\\\]]+\\\\]"}]',
      "utf-8",
    );

    expect(
      service.read_rule_preset({
        rule_type: "text_preserve",
        virtual_id: "builtin:renpy.json",
      }),
    ).toEqual({
      entries: [
        {
          entry_id: expect.any(String),
          src: "\\[[^\\]]+\\]",
          info: "",
        },
      ],
    });
  });

  it("读取预设时避开当前 kind 已有身份", () => {
    const { service, app_root } = create_service();
    const preset_dir = path.join(app_root, "builtin", "glossary", "preset");
    fs.mkdirSync(preset_dir, { recursive: true });
    fs.writeFileSync(path.join(preset_dir, "collision.json"), '[{"src":"A","dst":"甲"}]', "utf-8");

    let call_count = 0;
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((value: Uint8Array) => {
      value.fill(call_count === 0 ? 0 : 1);
      call_count += 1;
      return value;
    }) as typeof globalThis.crypto.getRandomValues);

    const result = service.read_rule_preset({
      rule_type: "glossary",
      virtual_id: "builtin:collision.json",
    });
    const entries = result["entries"] as JsonRecord[];

    expect(entries[0]?.["entry_id"]).toBe("111111");
  });

  it("保存用户预设时不把项目内 entry_id 写入外部资源", () => {
    const { service } = create_service();

    const result = service.save_rule_preset({
      rule_type: "glossary",
      name: "demo",
      entries: [{ entry_id: "rule-1", src: "HP", dst: "生命值" }],
    });
    const preset_path = String((result["item"] as JsonRecord)["path"]);

    expect(JSON.parse(fs.readFileSync(preset_path, "utf-8"))).toEqual([
      {
        src: "HP",
        dst: "生命值",
        info: "",
        case_sensitive: false,
      },
    ]);
  });

  it("读取规则预设时拒绝带目录边界的虚拟文件名", () => {
    const { service } = create_service();

    expect(() =>
      service.read_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:../demo.json",
      }),
    ).toThrow(expect.objectContaining({ code: "request.validation_failed" }));
    expect(() =>
      service.read_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:folder/demo.json",
      }),
    ).toThrow(expect.objectContaining({ code: "request.validation_failed" }));
    expect(() =>
      service.read_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:folder\\demo.json",
      }),
    ).toThrow(expect.objectContaining({ code: "request.validation_failed" }));
  });

  it("导入与导出外部规则时保持服务响应形状", async () => {
    const { service, app_root } = create_service();
    const json_path = path.join(app_root, "rules.JSON");
    const text_path = path.join(app_root, "rules.txt");
    const export_path = path.join(app_root, "exports", "rules.xlsx");
    fs.writeFileSync(json_path, '[{"src":"HP","dst":"生命值"}]', "utf-8");
    fs.writeFileSync(text_path, "HP=生命值", "utf-8");

    await expect(service.import_rules({ rule_type: "glossary", path: json_path })).resolves.toEqual(
      {
        entries: [
          {
            entry_id: expect.any(String),
            src: "HP",
            dst: "生命值",
            info: "",
            case_sensitive: false,
          },
        ],
      },
    );
    await expect(service.import_rules({ rule_type: "glossary", path: text_path })).resolves.toEqual(
      { entries: [] },
    );
    await expect(service.import_rules({ rule_type: "glossary", path: "" })).resolves.toEqual({
      entries: [],
    });
    await expect(
      service.export_rules({
        rule_type: "glossary",
        path: export_path,
        entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
      }),
    ).resolves.toEqual({ path: path.join(app_root, "exports", "rules.json").replace(/\\/gu, "/") });
    expect(fs.existsSync(path.join(app_root, "exports", "rules.json"))).toBe(true);
    expect(fs.existsSync(export_path)).toBe(true);
  });

  it("外部规则批次含坏项时整批拒绝", async () => {
    const { service, app_root } = create_service();
    const json_path = path.join(app_root, "invalid-rules.json");
    fs.writeFileSync(json_path, '[{"src":"HP","dst":"生命值"},42]', "utf-8");

    await expect(service.import_rules({ rule_type: "glossary", path: json_path })).rejects.toThrow(
      expect.objectContaining({ code: "request.validation_failed" }),
    );
  });

  it("任务 busy 时拒绝全部质量项目写但不阻塞预设文件 IO", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service } = create_workbench_service(database, "batch_translation");
    const project_writes = [
      () =>
        service.update({
          rule_type: "glossary",
          entries: [],
          expected_section_revisions: { quality: 0 },
        }),
      () =>
        service.update({
          rule_type: "glossary",
          meta: { enabled: false },
          expected_section_revisions: { quality: 0 },
        }),
    ];

    for (const write of project_writes) {
      await expect(write()).rejects.toThrow(expect.objectContaining({ code: "runtime.busy" }));
    }
    expect(() =>
      service.save_rule_preset({
        rule_type: "glossary",
        name: "busy-allowed",
        entries: [],
      }),
    ).not.toThrow();
  });

  it("规则条目与 meta 同一事务提交且只发布一次 project.data_changed", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service, lg_path, publisher } = create_workbench_service(database);

    await expect(
      service.update({
        rule_type: "glossary",
        expected_section_revisions: { quality: 0 },
        entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
        meta: { enabled: false },
      }),
    ).resolves.toMatchObject({
      accepted: true,
      changes: [
        {
          source: "quality_rule_update",
          sectionRevisions: { quality: 1 },
          updatedSections: ["quality"],
        },
      ],
    });
    expect(publisher.publish_project_change.mock.calls[0]?.[0]).toMatchObject({
      projectPath: lg_path,
      source: "quality_rule_update",
      updatedSections: ["quality"],
    });
    expect(publisher.publish_project_change).toHaveBeenCalledTimes(1);
    expect(database.get_all_meta(lg_path)).toMatchObject({
      glossary_enable: false,
      "quality_rule_revision.glossary": 1,
    });

    publisher.publish_project_change.mockClear();
    await expect(
      service.update({
        rule_type: "glossary",
        expected_section_revisions: { quality: 0 },
        entries: [],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "data.revision_conflict" }));
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
    expect(database.get_rules(lg_path, "glossary")).toEqual([
      { entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false },
    ]);
  });

  it("保存质量规则时保留稳定 entry_id", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service, lg_path } = create_workbench_service(database);

    await service.update({
      rule_type: "glossary",
      expected_section_revisions: { quality: 0 },
      entries: [{ entry_id: "rule-1", src: "HP", dst: "生命值" }],
    });

    expect(database.get_rules(lg_path, "glossary")).toEqual([
      {
        entry_id: "rule-1",
        src: "HP",
        dst: "生命值",
        info: "",
        case_sensitive: false,
      },
    ]);
  });

  it("保存质量规则时拒绝缺失 entry_id", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service } = create_workbench_service(database);

    await expect(
      service.update({
        rule_type: "glossary",
        expected_section_revisions: { quality: 0 },
        entries: [{ src: "HP", dst: "生命值" }],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "request.validation_failed" }));
  });

  it("保存质量规则时拒绝旧 expected_revision 字段", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service, publisher } = create_workbench_service(database);

    await expect(
      service.update({
        rule_type: "glossary",
        expected_revision: 0,
        expected_section_revisions: { quality: 0 },
        entries: [],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "request.validation_failed" }));
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("读取当前质量规则切片与 revision", () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service } = create_workbench_service(database);

    expect(service.query({ rule_type: "glossary" })).toMatchObject({
      qualityRule: {
        enabled: true,
        entries: [
          { entry_id: "000000", src: "HP", dst: "生命值", info: "", case_sensitive: false },
        ],
      },
      sectionRevisions: { quality: 0 },
    });
  });

  /**
   * 构造只依赖预设文件 IO 的质量规则服务，数据库边界在这些用例中不参与。
   */
  function create_service(runtime_owner: "batch_translation" | "agent" | null = null): {
    service: QualityRuleService;
    app_root: string;
    settings: AppSettingService;
    native_fs: NativeFs;
  } {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-quality-test-"));
    cleanup_paths.push(app_root);
    const paths = new AppPathService({
      appRoot: app_root,
      builtinRoot: path.join(app_root, "builtin"),
      env: {},
      platform: process.platform,
    });
    paths.get_data_root(); // 夹具先完成目录探针，业务用例可独立控制随机 ID 序列。
    const database = null as unknown as ProjectDatabase;
    const settings = new AppSettingService(paths);
    const native_fs = new NativeFs();
    const service = new QualityRuleService(
      paths,
      settings,
      new ProjectSessionState(),
      new ProjectWriteStore(database, vi.fn(), null),
      create_runtime_gate(runtime_owner),
      create_cache(),
      native_fs,
    );
    return { service, app_root, settings, native_fs };
  }

  /**
   * 构造带真实 ProjectWriteStore 的质量服务，验证写入和项目变更事件。
   */
  function create_workbench_service(
    database: ProjectDatabase,
    runtime_owner: "batch_translation" | "agent" | null = null,
  ): {
    service: QualityRuleService;
    lg_path: string;
    publisher: ReturnType<typeof create_test_project_change_publisher>;
    runtime_gate: RuntimeOperationGate;
  } {
    const { app_root } = create_service();
    const paths = new AppPathService({
      appRoot: app_root,
      builtinRoot: path.join(app_root, "builtin"),
      env: {},
      platform: process.platform,
    });
    const session_state = new ProjectSessionState();
    const project_event_bus = vi.fn();
    const lg_path = path.join(app_root, "quality.lg");
    const publisher = create_test_project_change_publisher(lg_path);
    database.create_project(lg_path, "quality");
    session_state.mark_loaded(lg_path);
    const runtime_gate = create_runtime_gate(runtime_owner);
    return {
      service: new QualityRuleService(
        paths,
        new AppSettingService(paths),
        session_state,
        new ProjectWriteStore(database, project_event_bus, publisher.publish_project_change),
        runtime_gate,
        create_cache(),
      ),
      lg_path,
      publisher,
      runtime_gate,
    };
  }

  /**
   * 公开通知沿用提交事实，测试复用生产事件适配器。
   */
  function create_test_project_change_publisher(lg_path: string) {
    return {
      publish_project_change: vi.fn((payload: ProjectCommittedChange): ProjectChangeEvent => {
        const session = new ProjectSessionState();
        session.mark_loaded(lg_path);
        return adapt_project_change(session, payload)!;
      }),
    };
  }

  /** 创建指定占用状态，验证写入口的互斥行为。 */
  function create_runtime_gate(owner: "batch_translation" | "agent" | null): RuntimeOperationGate {
    const gate = new RuntimeOperationGate();
    if (owner !== null) gate.begin_runtime(owner);
    return gate;
  }

  /** 提供规则测试需要的最小缓存事实。 */
  function create_cache(): CacheReadPort {
    return {
      readSectionRevisions: () => ({ quality: 0 }),
      quality: {
        readBlock: () => ({
          ...create_empty_quality_rule_block(),
          glossary: {
            enabled: true,
            mode: "off",
            revision: 0,
            entries: [
              { entry_id: "000000", src: "HP", dst: "生命值", info: "", case_sensitive: false },
            ],
          },
        }),
      },
      items: { readItems: () => [] },
    } as unknown as CacheReadPort;
  }
});

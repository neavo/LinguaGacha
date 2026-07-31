import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import type { JsonRecord, JsonValue } from "../../domain/json";
import { ProjectWriteStore } from "../project/project-write-store";
import { get_section_revision } from "../project/project-data-reader";
import { ProjectOperationGate } from "../project/project-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import { AppPathService } from "../app/app-path-service";
import type { CacheReadPort } from "../cache/cache-types";
import { QualityRuleService } from "./quality-rule-service";
import type { ProjectChangeEvent } from "../../shared/project-event";

describe("QualityRuleService", () => {
  const cleanup_paths: string[] = [];
  const cleanup_databases: ProjectDatabase[] = [];

  afterEach(() => {
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
    const preset_dir = path.join(app_root, "resource", "glossary", "preset");
    fs.mkdirSync(preset_dir, { recursive: true });
    fs.writeFileSync(path.join(preset_dir, "demo.json"), '\uFEFF[{"src":"A","dst":"甲"}]', "utf-8");

    expect(
      service.read_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:demo.json",
      }),
    ).toEqual({ entries: [{ src: "A", dst: "甲" }] });
  });

  it("读取 text_preserve 内置预设时使用质量规则预设目录", () => {
    const { service, app_root } = create_service();
    const preset_dir = path.join(app_root, "resource", "text_preserve", "preset"); // text_preserve 复用质量规则预设目录解析，避免简繁转换页再走专用接口
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
    ).toEqual({ entries: [{ src: "\\[[^\\]]+\\]" }] });
  });

  it("读取规则预设时拒绝带目录边界的虚拟文件名", () => {
    const { service } = create_service();

    expect(() =>
      service.read_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:../demo.json",
      }),
    ).toThrow("request.validation_failed");
    expect(() =>
      service.read_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:folder/demo.json",
      }),
    ).toThrow("request.validation_failed");
    expect(() =>
      service.read_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:folder\\demo.json",
      }),
    ).toThrow("request.validation_failed");
  });

  it("导入与导出外部规则时保持服务响应形状", async () => {
    const { service, app_root } = create_service();
    const json_path = path.join(app_root, "rules.JSON");
    const text_path = path.join(app_root, "rules.txt");
    const export_path = path.join(app_root, "exports", "rules.xlsx");
    fs.writeFileSync(json_path, '[{"src":"HP","dst":"生命值"}]', "utf-8");
    fs.writeFileSync(text_path, "HP=生命值", "utf-8");

    await expect(service.import_rules({ path: json_path })).resolves.toEqual({
      entries: [
        {
          src: "HP",
          dst: "生命值",
          info: "",
          regex: false,
          case_sensitive: false,
        },
      ],
    });
    await expect(service.import_rules({ path: text_path })).resolves.toEqual({ entries: [] });
    await expect(service.import_rules({ path: "" })).resolves.toEqual({ entries: [] });
    await expect(
      service.export_rules({
        path: export_path,
        entries: [{ src: "HP", dst: "生命值" }],
      }),
    ).resolves.toEqual({ path: path.join(app_root, "exports", "rules.json").replace(/\\/gu, "/") });
    expect(fs.existsSync(path.join(app_root, "exports", "rules.json"))).toBe(true);
    expect(fs.existsSync(export_path)).toBe(true);
  });

  it("任务 busy 时拒绝全部质量项目写但不阻塞预设文件 IO", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service } = create_workbench_service(database, () => true);
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
      () =>
        service.import_analysis_glossary({
          entries: [],
          consumed_candidate_srcs: [],
          expected_section_revisions: { quality: 0, analysis: 0 },
        }),
    ];

    for (const write of project_writes) {
      await expect(write()).rejects.toThrow("task.busy");
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
        entries: [{ src: "HP", dst: "生命值" }],
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
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
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
      service.update(
        {
          rule_type: "glossary",
          expected_section_revisions: { quality: 1 },
          meta: { enabled: true },
        },
        "agent_quality_rule_update",
      ),
    ).resolves.toMatchObject({
      changes: [{ source: "agent_quality_rule_update", sectionRevisions: { quality: 2 } }],
    });
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "agent_quality_rule_update",
      updatedSections: ["quality"],
    });

    publisher.publish_project_change.mockClear();
    await expect(
      service.update({
        rule_type: "glossary",
        expected_section_revisions: { quality: 0 },
        entries: [],
      }),
    ).rejects.toThrow("data.revision_conflict");
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
    expect(database.get_rules(lg_path, "glossary")).toEqual([
      { src: "HP", dst: "生命值", info: "", regex: false, case_sensitive: false },
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
        regex: false,
        case_sensitive: false,
      },
    ]);
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
    ).rejects.toThrow("request.validation_failed");
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
  });

  it("CLI 分析导出从候选池生成 glossary.json 与 glossary.xlsx", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service, lg_path } = create_workbench_service(database);
    const output_dir = path.join(path.dirname(lg_path), "analysis-out");
    database.upsert_analysis_candidate_aggregates(lg_path, [
      {
        src: "姫",
        dst_votes: { 公主: 1, 姬: 3 },
        info_votes: { 角色名: 2 },
        observation_count: 4,
        first_seen_at: "2026-05-16T00:00:00.000Z",
        last_seen_at: "2026-05-16T00:02:00.000Z",
        case_sensitive: true,
      },
      {
        src: "\\N[1]",
        dst_votes: { "\\N[1]": 1 },
        info_votes: { 控制码: 1 },
        observation_count: 1,
        first_seen_at: "2026-05-16T00:03:00.000Z",
        last_seen_at: "2026-05-16T00:03:00.000Z",
        case_sensitive: false,
      },
      {
        src: "王",
        dst_votes: { 王: 2 },
        info_votes: { other: 2 },
        observation_count: 2,
        first_seen_at: "2026-05-16T00:04:00.000Z",
        last_seen_at: "2026-05-16T00:04:00.000Z",
        case_sensitive: false,
      },
    ]);

    const result = await service.export_analysis_candidates_to_directory(output_dir);
    const json_path = String(result["json_path"] ?? "");
    const xlsx_path = String(result["xlsx_path"] ?? "");
    const entries = JSON.parse(fs.readFileSync(json_path, "utf-8")) as JsonValue[];

    expect(result).toMatchObject({ entry_count: 2 });
    expect(entries).toEqual([
      { src: "\\N[1]", dst: "\\N[1]", info: "控制码", regex: false, case_sensitive: false },
      { src: "姫", dst: "姬", info: "角色名", regex: false, case_sensitive: true },
    ]);
    expect(fs.existsSync(xlsx_path)).toBe(true);
  });

  it("读取当前质量规则切片与 revision", () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service } = create_workbench_service(database);

    expect(service.query({ rule_type: "glossary" })).toMatchObject({
      qualityRule: {
        enabled: true,
        entries: [{ src: "HP", dst: "生命值" }],
      },
      sectionRevisions: { quality: 0, analysis: 0 },
    });
  });

  it("分析术语导入写入变化规则并消费候选池", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service, lg_path } = create_workbench_service(database);
    database.set_rules(lg_path, "glossary", [
      { src: "艾琳", dst: "Eileen", info: "旧名", regex: false, case_sensitive: true },
    ]);
    database.upsert_analysis_candidate_aggregates(lg_path, [
      {
        src: "艾琳",
        dst_votes: { Erin: 1 },
        info_votes: { 角色名: 1 },
        observation_count: 1,
        first_seen_at: "t",
        last_seen_at: "t",
        case_sensitive: true,
      },
    ]);

    const result = await service.import_analysis_glossary({
      entries: [{ src: "艾琳", dst: "Erin", info: "角色名", regex: false, case_sensitive: true }],
      consumed_candidate_srcs: ["艾琳"],
      expected_section_revisions: { quality: 0, analysis: 0 },
    });

    expect(result).toMatchObject({
      accepted: true,
      changes: [{ updatedSections: ["quality", "analysis"] }],
    });
    expect(database.get_rules(lg_path, "glossary")).toEqual([
      { src: "艾琳", dst: "Erin", info: "角色名", regex: false, case_sensitive: true },
    ]);
    expect(database.get_analysis_candidate_aggregates(lg_path)).toEqual([]);
  });

  /**
   * 构造只依赖预设文件 IO 的质量规则服务，数据库边界在这些用例中不参与。
   */
  function create_service(read_task_busy: () => boolean = () => false): {
    service: QualityRuleService;
    app_root: string;
  } {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-quality-test-"));
    cleanup_paths.push(app_root);
    const paths = new AppPathService({
      appRoot: app_root,
      env: {},
      platform: process.platform,
    });
    const database = null as unknown as ProjectDatabase;
    const service = new QualityRuleService(
      paths,
      database,
      new ProjectSessionState(),
      new ProjectWriteStore(database, vi.fn(), null),
      new ProjectOperationGate(read_task_busy),
      create_cache(),
    );
    return { service, app_root };
  }

  /**
   * 构造带真实 ProjectWriteStore 的质量服务，验证写入和项目变更事件。
   */
  function create_workbench_service(
    database: ProjectDatabase,
    read_task_busy: () => boolean = () => false,
  ): {
    service: QualityRuleService;
    lg_path: string;
    publisher: ReturnType<typeof create_test_project_change_publisher>;
  } {
    const { app_root } = create_service();
    const paths = new AppPathService({
      appRoot: app_root,
      env: {},
      platform: process.platform,
    });
    const session_state = new ProjectSessionState();
    const project_event_bus = vi.fn();
    const lg_path = path.join(app_root, "quality.lg");
    const publisher = create_test_project_change_publisher(database, lg_path);
    database.create_project(lg_path, "quality");
    session_state.mark_loaded(lg_path);
    return {
      service: new QualityRuleService(
        paths,
        database,
        session_state,
        new ProjectWriteStore(database, project_event_bus, publisher.publish_project_change),
        new ProjectOperationGate(read_task_busy),
        create_cache(),
      ),
      lg_path,
      publisher,
    };
  }

  /**
   * 用数据库 meta 生成测试用 project change，保持 revision 断言接近运行态。
   */
  function create_test_project_change_publisher(database: ProjectDatabase, lg_path: string) {
    return {
      publish_project_change: vi.fn((payload: JsonRecord): ProjectChangeEvent => {
        const updated_sections = Array.isArray(payload.updatedSections)
          ? payload.updatedSections.map((section) => String(section))
          : [];
        const meta = database.get_all_meta(lg_path) as JsonRecord;
        const section_revisions = Object.fromEntries(
          updated_sections.map((section) => [section, get_section_revision(meta, section)]),
        );
        return {
          type: "project.changed",
          eventId: `test-${String(payload.source ?? "project_change")}`,
          source: String(payload.source ?? "project_change"),
          projectPath: String(payload.projectPath ?? ""),
          projectRevision: Math.max(...Object.values(section_revisions), 0),
          sectionRevisions: section_revisions,
          updatedSections: updated_sections as ProjectChangeEvent["updatedSections"],
          ...(payload.sections === undefined
            ? {}
            : { sections: payload.sections as ProjectChangeEvent["sections"] }),
        };
      }),
    };
  }

  function create_cache(): CacheReadPort {
    return {
      readSectionRevisions: () => ({ quality: 0, analysis: 0 }),
      quality: {
        readBlock: () => ({
          glossary: {
            enabled: true,
            revision: 0,
            entries: [{ src: "HP", dst: "生命值" }],
          },
        }),
      },
      items: { readItems: () => [] },
    } as unknown as CacheReadPort;
  }
});

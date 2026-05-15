import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import type { ProjectChangePublisher } from "../project/project-change-publisher";
import { ProjectSessionState } from "../project/project-session-state";
import { AppPathService } from "./path-service";
import { SettingService } from "./setting-service";
import { QualityService } from "./quality-service";

describe("QualityService", () => {
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

  it("导入外部 JSON 规则时显式修复可恢复的非标 JSON", async () => {
    const { service, app_root } = create_service();
    const file_path = path.join(app_root, "rules.json");
    fs.writeFileSync(file_path, '[{"src":"A","dst":"甲",},]', "utf-8");

    await expect(service.import_rules({ path: file_path })).resolves.toEqual({
      entries: [
        {
          src: "A",
          dst: "甲",
          info: "",
          regex: false,
          case_sensitive: false,
        },
      ],
    });
  });

  it("导入外部规则时按扩展名分发并拒绝未知格式", async () => {
    const { service, app_root } = create_service();
    const json_path = path.join(app_root, "rules.JSON");
    const text_path = path.join(app_root, "rules.txt");
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
  });

  it("导入外部 JSON 规则时兼容列表、RPG Maker Actors 与 KV 字典", async () => {
    const { service, app_root } = create_service();
    const list_path = path.join(app_root, "list.json");
    const actors_path = path.join(app_root, "actors.json");
    const kv_path = path.join(app_root, "kv.json");
    fs.writeFileSync(
      list_path,
      JSON.stringify([{ src: " HP ", dst: "生命值", info: "i", regex: 1 }, { src: "   " }, "bad"]),
      "utf-8",
    );
    fs.writeFileSync(
      actors_path,
      JSON.stringify([
        { id: 7, name: "勇者", nickname: "小勇" },
        { id: 8, name: "", nickname: "弓手" },
      ]),
      "utf-8",
    );
    fs.writeFileSync(kv_path, JSON.stringify({ A: "甲", "": "skip", B: null }), "utf-8");

    await expect(service.import_rules({ path: list_path })).resolves.toEqual({
      entries: [
        {
          src: "HP",
          dst: "生命值",
          info: "i",
          regex: true,
          case_sensitive: false,
        },
      ],
    });
    await expect(service.import_rules({ path: actors_path })).resolves.toEqual({
      entries: [
        { src: "\\n[7]", dst: "勇者", info: "", regex: false, case_sensitive: false },
        { src: "\\N[7]", dst: "勇者", info: "", regex: false, case_sensitive: false },
        { src: "\\nn[7]", dst: "小勇", info: "", regex: false, case_sensitive: false },
        { src: "\\NN[7]", dst: "小勇", info: "", regex: false, case_sensitive: false },
        { src: "\\nn[8]", dst: "弓手", info: "", regex: false, case_sensitive: false },
        { src: "\\NN[8]", dst: "弓手", info: "", regex: false, case_sensitive: false },
      ],
    });
    await expect(service.import_rules({ path: kv_path })).resolves.toEqual({
      entries: [
        { src: "A", dst: "甲", info: "", regex: false, case_sensitive: false },
        { src: "B", dst: "", info: "", regex: false, case_sensitive: false },
      ],
    });
  });

  it("导入外部 XLSX 规则时跳过表头和空首列并解析布尔字段", async () => {
    const { service, app_root } = create_service();
    const file_path = path.join(app_root, "rules.xlsx");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("rules");
    sheet.getCell(1, 1).value = "src";
    sheet.getCell(1, 2).value = "dst";
    sheet.getCell(2, 1).value = "HP";
    sheet.getCell(2, 2).value = "生命值";
    sheet.getCell(2, 3).value = "term";
    sheet.getCell(2, 4).value = "true";
    sheet.getCell(2, 5).value = "TRUE";
    sheet.getCell(3, 1).value = "";
    sheet.getCell(3, 2).value = "应跳过";
    sheet.getCell(4, 1).value = "MP";
    sheet.getCell(4, 2).value = "魔力";
    await workbook.xlsx.writeFile(file_path);

    await expect(service.import_rules({ path: file_path })).resolves.toEqual({
      entries: [
        {
          src: "HP",
          dst: "生命值",
          info: "term",
          regex: true,
          case_sensitive: true,
        },
        {
          src: "MP",
          dst: "魔力",
          info: "",
          regex: false,
          case_sensitive: false,
        },
      ],
    });
  });

  it("导出外部 XLSX 规则时复用表格工具样式并转义公式文本", async () => {
    const { service, app_root } = create_service();
    const file_path = path.join(app_root, "exports", "rules.xlsx");

    await service.export_rules({
      path: file_path,
      entries: [{ src: "=SUM(A1:A2)", dst: "甲", info: "", regex: false, case_sensitive: false }],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file_path);
    const sheet = workbook.worksheets[0];

    expect(sheet?.getCell(1, 1).value).toBe("src");
    expect(sheet?.getCell(2, 1).value).toBe("'=SUM(A1:A2)");
    expect(sheet?.getCell(2, 1).font.size).toBe(10);
    expect(sheet?.getCell(2, 1).alignment.horizontal).toBe("left");
  });

  it("保存质量规则后发布 project.data_changed，失败时不发布", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service, lg_path, publisher } = create_project_service(database);

    await expect(
      service.save_rule_entries({
        rule_type: "glossary",
        expected_revision: 0,
        entries: [{ src: "HP", dst: "生命值" }],
      }),
    ).resolves.toMatchObject({
      accepted: true,
      sectionRevisions: { quality: 1 },
    });
    expect(publisher.publish_project_change).toHaveBeenCalledWith({
      source: "quality_rule_save_entries",
      updatedSections: ["quality"],
      sections: {
        quality: { payloadMode: "canonical-delta" },
      },
    });

    publisher.publish_project_change.mockClear();
    await expect(
      service.save_rule_entries({
        rule_type: "glossary",
        expected_revision: 0,
        entries: [],
      }),
    ).rejects.toThrow("data.revision_conflict");
    expect(publisher.publish_project_change).not.toHaveBeenCalled();
    expect(
      database.execute({ name: "getRules", args: { projectPath: lg_path, ruleType: "glossary" } }),
    ).toEqual([{ src: "HP", dst: "生命值", info: "", regex: false, case_sensitive: false }]);
  });

  it("保存质量规则时保留稳定 entry_id", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service, lg_path } = create_project_service(database);

    await service.save_rule_entries({
      rule_type: "glossary",
      expected_revision: 0,
      entries: [{ entry_id: "rule-1", src: "HP", dst: "生命值" }],
    });

    expect(
      database.execute({ name: "getRules", args: { projectPath: lg_path, ruleType: "glossary" } }),
    ).toEqual([
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

  function create_service(): { service: QualityService; app_root: string } {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-quality-test-"));
    cleanup_paths.push(app_root);
    const paths = new AppPathService({
      appRoot: app_root,
      env: {},
      platform: process.platform,
    });
    const setting_service = new SettingService(paths);
    const service = new QualityService(
      paths,
      setting_service,
      null as unknown as ProjectDatabase,
      new ProjectSessionState(),
    );
    return { service, app_root };
  }

  function create_project_service(database: ProjectDatabase): {
    service: QualityService;
    lg_path: string;
    publisher: { publish_project_change: ReturnType<typeof vi.fn> };
  } {
    const { app_root } = create_service();
    const paths = new AppPathService({
      appRoot: app_root,
      env: {},
      platform: process.platform,
    });
    const setting_service = new SettingService(paths);
    const session_state = new ProjectSessionState();
    const lg_path = path.join(app_root, "quality.lg");
    const publisher = { publish_project_change: vi.fn() };
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "quality" },
    });
    session_state.mark_loaded(lg_path);
    return {
      service: new QualityService(
        paths,
        setting_service,
        database,
        session_state,
        publisher as unknown as ProjectChangePublisher,
      ),
      lg_path,
      publisher,
    };
  }
});

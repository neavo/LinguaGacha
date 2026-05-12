import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import { ProjectSessionState } from "../project/project-session-state";
import { AppPathService } from "./path-service";
import { SettingService } from "./setting-service";
import { QualityService } from "./quality-service";

describe("QualityService", () => {
  const cleanup_paths: string[] = [];

  afterEach(() => {
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
    ).toThrow("invalid virtual preset id");
    expect(() =>
      service.read_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:folder/demo.json",
      }),
    ).toThrow("invalid virtual preset id");
    expect(() =>
      service.read_rule_preset({
        rule_type: "glossary",
        virtual_id: "builtin:folder\\demo.json",
      }),
    ).toThrow("invalid virtual preset id");
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
});

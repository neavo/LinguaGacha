import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { CoreBridgeClient } from "../core/core-bridge-client";
import { AppPathService } from "../paths/app-path-service";
import { ConfigService } from "../settings/config-service";
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
        preset_dir_name: "glossary",
        virtual_id: "builtin:demo.json",
      }),
    ).toEqual({ entries: [{ src: "A", dst: "甲" }] });
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

  function create_service(): { service: QualityService; app_root: string } {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-quality-test-"));
    cleanup_paths.push(app_root);
    const paths = new AppPathService({
      appRoot: app_root,
      env: {},
      platform: process.platform,
    });
    const config_service = new ConfigService(paths);
    const service = new QualityService(
      paths,
      config_service,
      null as unknown as ProjectDatabase,
      null as unknown as CoreBridgeClient,
    );
    return { service, app_root };
  }
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LogManager } from "../../log/log-manager";
import { AppPathService } from "../../app/app-path-service";
import { JsonTool } from "../../../shared/utils/json-tool";
import { legacy_default_config_migration } from "./legacy-default-config-migration";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-config-migration-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("legacy_default_config_migration", () => {
  it("当前配置不存在时按旧优先级复制默认配置", () => {
    const context = create_context();
    write_file(
      path.join(temp_dir, "resource", "config.json"),
      JsonTool.stringifyStrict({ clean_ruby: true }),
    );

    legacy_default_config_migration.run_startup?.(context);

    expect(
      JsonTool.parseStrict(fs.readFileSync(path.join(temp_dir, "userdata", "config.json"))),
    ).toEqual({ clean_ruby: true });
  });

  it("当前配置已存在时不被旧配置覆盖", () => {
    const context = create_context();
    write_file(
      path.join(temp_dir, "userdata", "config.json"),
      JsonTool.stringifyStrict({ clean_ruby: false }),
    );
    write_file(
      path.join(temp_dir, "resource", "config.json"),
      JsonTool.stringifyStrict({ clean_ruby: true }),
    );

    legacy_default_config_migration.run_startup?.(context);

    expect(
      JsonTool.parseStrict(fs.readFileSync(path.join(temp_dir, "userdata", "config.json"))),
    ).toEqual({ clean_ruby: false });
  });
});

/**
 * 启动期迁移 context 使用真实 AppPathService，让配置优先级按 appRoot/dataRoot 规则计算。
 */
function create_context() {
  return {
    paths: new AppPathService({ appRoot: temp_dir }),
    log_manager: { warning(): void {} } as unknown as LogManager,
  };
}

/**
 * 写入旧配置候选文件时同步创建父目录，贴近发布包 resource 结构。
 */
function write_file(file_path: string, text: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, text, "utf-8");
}

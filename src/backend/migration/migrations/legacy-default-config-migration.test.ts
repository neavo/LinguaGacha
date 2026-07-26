import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { LogManager } from "../../log/log-manager";
import { AppPathService } from "../../app/app-path-service";
import { JsonTool } from "../../../shared/utils/json-tool";
import { legacy_default_config_migration } from "./legacy-default-config-migration";

describe("legacy_default_config_migration", () => {
  it("当前配置不存在时按旧优先级复制默认配置", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-config-migration-"),
    );
    const context = create_context(temp_dir.path);
    write_file(
      path.join(temp_dir.path, "resource", "config.json"),
      JsonTool.stringifyStrict({ clean_ruby: true }),
    );

    legacy_default_config_migration.run_startup?.(context);

    expect(
      JsonTool.parseStrict(fs.readFileSync(path.join(temp_dir.path, "userdata", "config.json"))),
    ).toEqual({ clean_ruby: true });
  });

  it("当前配置已存在时不被旧配置覆盖", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-config-migration-"),
    );
    const context = create_context(temp_dir.path);
    write_file(
      path.join(temp_dir.path, "userdata", "config.json"),
      JsonTool.stringifyStrict({ clean_ruby: false }),
    );
    write_file(
      path.join(temp_dir.path, "resource", "config.json"),
      JsonTool.stringifyStrict({ clean_ruby: true }),
    );

    legacy_default_config_migration.run_startup?.(context);

    expect(
      JsonTool.parseStrict(fs.readFileSync(path.join(temp_dir.path, "userdata", "config.json"))),
    ).toEqual({ clean_ruby: false });
  });
});

function create_context(app_root: string) {
  return {
    paths: new AppPathService({ appRoot: app_root }),
    log_manager: { warning(): void {} } as unknown as LogManager,
  };
}

function write_file(file_path: string, text: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, text, "utf-8");
}

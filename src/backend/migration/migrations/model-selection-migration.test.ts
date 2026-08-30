import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { JsonRecord } from "../../../domain/json";
import type { LogManager } from "../../log/log-manager";
import { AppPathService } from "../../app/app-path-service";
import { JsonTool } from "../../../shared/utils/json-tool";
import { model_selection_migration } from "./model-selection-migration";

describe("model_selection_migration", () => {
  it("把旧激活模型迁到三个用途并保持重复执行幂等", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-model-selection-migration-"),
    );
    const context = create_context(temp_dir.path);
    write_config(context.paths.get_config_path(), {
      activate_model_id: " legacy-model ",
      clean_ruby: true,
      models: [{ id: "legacy-model" }, { id: "other-model" }],
    });

    model_selection_migration.run_startup?.(context);
    model_selection_migration.run_startup?.(context);

    expect(read_config(context.paths.get_config_path())).toEqual({
      clean_ruby: true,
      models: [{ id: "legacy-model" }, { id: "other-model" }],
      model_selection: {
        translation: "legacy-model",
        analysis: "legacy-model",
        agent: "legacy-model",
      },
    });
  });

  it("保留已有用途选择并只用旧激活模型补空项", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-model-selection-migration-"),
    );
    const context = create_context(temp_dir.path);
    write_config(context.paths.get_config_path(), {
      activate_model_id: "legacy-model",
      model_selection: {
        translation: "translation-model",
        analysis: "",
        agent: "agent-model",
        unknown: "ignored",
      },
    });

    model_selection_migration.run_startup?.(context);

    expect(read_config(context.paths.get_config_path())).toEqual({
      model_selection: {
        translation: "translation-model",
        analysis: "legacy-model",
        agent: "agent-model",
      },
    });
  });
});

function create_context(app_root: string) {
  return {
    paths: new AppPathService({
      appRoot: app_root,
      builtinRoot: path.join(app_root, "builtin"),
    }),
    log_manager: { warning(): void {} } as unknown as LogManager,
  };
}

function write_config(config_path: string, payload: JsonRecord): void {
  fs.mkdirSync(path.dirname(config_path), { recursive: true });
  fs.writeFileSync(config_path, JsonTool.stringifyStrict(payload), "utf-8");
}

function read_config(config_path: string): JsonRecord {
  return JsonTool.parseStrict(fs.readFileSync(config_path, "utf-8")) as JsonRecord;
}

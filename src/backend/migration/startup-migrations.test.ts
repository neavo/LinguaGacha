import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { LogManager } from "../log/log-manager";
import { AppPathService } from "../app/app-path-service";
import { run_startup_migrations } from "./startup-migrations";

it("启动先迁入旧配置，再转换预设引用与模型选择，并等待文件搬迁完成", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-startup-migrations-"));
  const preset = path.join(temp.path, "resource/preset/glossary/user/mine.json");
  fs.mkdirSync(path.dirname(preset), { recursive: true });
  fs.writeFileSync(preset, "[]");
  fs.writeFileSync(
    path.join(temp.path, "resource/config.json"),
    JSON.stringify({
      activate_model_id: "legacy",
      glossary_default_preset: "resource/preset/glossary/user/mine.json",
    }),
  );
  const paths = new AppPathService({
    appRoot: temp.path,
    builtinRoot: path.join(temp.path, "builtin"),
  });
  await run_startup_migrations({ paths, log_manager: { warning() {} } as unknown as LogManager });
  expect(JSON.parse(fs.readFileSync(paths.get_config_path(), "utf8"))).toEqual({
    glossary_default_preset: "user:mine.json",
    model_selection: { translation: "legacy", agent: "legacy", agent_batch_translation: null },
  });
  expect(
    fs.readFileSync(
      path.join(paths.get_quality_rule_user_preset_dir("glossary"), "mine.json"),
      "utf8",
    ),
  ).toBe("[]");
  expect(fs.existsSync(preset)).toBe(false);
});

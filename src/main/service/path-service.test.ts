import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppPathService } from "./path-service";

const cleanup_roots: string[] = [];

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const temp_root = cleanup_roots.pop();
    if (temp_root !== undefined) {
      fs.rmSync(temp_root, { force: true, recursive: true });
    }
  }
});

describe("AppPathService", () => {
  it("应用根可写时把资源、配置、日志和预设路径收口到同一应用根", () => {
    const app_root = create_temp_root("linguagacha-path-service-");
    fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3\n", "utf-8");
    const service = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });

    expect(service.get_app_root()).toBe(path.resolve(app_root));
    expect(service.get_data_root()).toBe(path.resolve(app_root));
    expect(service.get_config_path()).toBe(path.join(app_root, "userdata", "config.json"));
    expect(service.get_log_dir()).toBe(path.join(app_root, "log"));
    expect(service.get_model_preset_dir()).toBe(path.join(app_root, "resource", "model", "preset"));
    expect(service.get_quality_rule_builtin_preset_dir("glossary")).toBe(
      path.join(app_root, "resource", "glossary", "preset"),
    );
    expect(service.get_quality_rule_builtin_preset_relative_dir("glossary")).toBe(
      "resource/glossary/preset",
    );
    expect(service.get_prompt_template_dir("translation", "ZH")).toBe(
      path.join(app_root, "resource", "translation_prompt", "template", "zh"),
    );
    expect(service.get_prompt_builtin_preset_relative_dir("analysis")).toBe(
      "resource/analysis_prompt/preset",
    );
    expect(service.read_version()).toBe("1.2.3");
  });

  it("打包态或不可写应用根把可写数据落到用户 LinguaGacha 根", () => {
    const app_root = create_temp_root("linguagacha-path-fallback-");
    const home_data_root = path.join(os.homedir(), "LinguaGacha");
    const appimage_service = new AppPathService({
      appRoot: app_root,
      env: { APPIMAGE: "/tmp/LinguaGacha.AppImage" },
      platform: "linux",
    });
    const blocked_app_root = path.join(app_root, "blocked-file");
    fs.writeFileSync(blocked_app_root, "not a directory", "utf-8");
    const blocked_service = new AppPathService({
      appRoot: blocked_app_root,
      env: {},
      platform: "win32",
    });

    expect(appimage_service.get_data_root()).toBe(home_data_root);
    expect(blocked_service.get_data_root()).toBe(home_data_root);
  });

  it("未知提示词任务类型不会生成资源路径", () => {
    const app_root = create_temp_root("linguagacha-path-invalid-prompt-");
    const service = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });

    expect(() => service.get_prompt_template_dir("proofreading", "zh")).toThrow(
      "runtime.internal_invariant",
    );
  });
});

function create_temp_root(prefix: string): string {
  const temp_root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup_roots.push(temp_root);
  return temp_root;
}

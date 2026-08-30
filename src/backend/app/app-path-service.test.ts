import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppPathService, resolve_preset_file } from "./app-path-service";

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
  it("显式区分内置资产根、应用根与可写数据根", () => {
    const app_root = create_temp_root("linguagacha-path-service-");
    const builtin_root = path.join(app_root, "builtin");
    const service = new AppPathService({
      appRoot: app_root,
      builtinRoot: builtin_root,
      env: {},
      platform: "win32",
    });

    expect(service.get_app_root()).toBe(path.resolve(app_root));
    expect(service.get_data_root()).toBe(path.resolve(app_root));
    expect(service.get_config_path()).toBe(path.join(app_root, "userdata", "config.json"));
    expect(service.get_berserker_update_root_dir()).toBe(
      path.join(app_root, "userdata", "berserker"),
    );
    expect(service.get_agent_workspace_root_dir()).toBe(
      path.join(app_root, "userdata", "agent", "workspace"),
    );
    expect(service.get_berserker_version_dir("1.2.4")).toBe(
      path.join(app_root, "userdata", "berserker", "v1.2.4"),
    );
    expect(service.get_version_path()).toBe(path.join(app_root, "version.txt"));
    expect(service.get_log_dir()).toBe(path.join(app_root, "log"));
    expect(service.get_model_preset_dir()).toBe(path.join(builtin_root, "model", "preset"));
    expect(service.get_agent_system_prompt_path()).toBe(
      path.join(builtin_root, "agent", "system_prompt.md"),
    );
    expect(service.get_agent_session_seed_path()).toBe(
      path.join(builtin_root, "agent", "session_seed.json"),
    );
    expect(service.get_agent_builtin_skill_dir()).toBe(path.join(builtin_root, "agent", "skill"));
    expect(service.get_agent_user_skill_dir()).toBe(
      path.join(app_root, "userdata", "agent", "skill"),
    );
    expect(service.get_quality_rule_builtin_preset_dir("glossary")).toBe(
      path.join(builtin_root, "glossary", "preset"),
    );
    expect(service.get_quality_rule_builtin_preset_relative_dir("glossary")).toBe(
      "builtin/glossary/preset",
    );
    expect(service.get_prompt_template_dir("translation", "ZH")).toBe(
      path.join(builtin_root, "translation_prompt", "template", "zh"),
    );
    expect(service.get_prompt_builtin_preset_relative_dir("analysis")).toBe(
      "builtin/analysis_prompt/preset",
    );
  });

  it("打包态或不可写应用根把可写数据落到用户 LinguaGacha 根", () => {
    const app_root = create_temp_root("linguagacha-path-fallback-");
    const home_data_root = path.join(os.homedir(), "LinguaGacha");
    const appimage_service = new AppPathService({
      appRoot: app_root,
      builtinRoot: path.join(app_root, "builtin"),
      env: { APPIMAGE: "/tmp/LinguaGacha.AppImage" },
      platform: "linux",
    });
    const blocked_app_root = path.join(app_root, "blocked-file");
    fs.writeFileSync(blocked_app_root, "not a directory", "utf-8");
    const blocked_service = new AppPathService({
      appRoot: blocked_app_root,
      builtinRoot: path.join(app_root, "builtin"),
      env: {},
      platform: "win32",
    });

    expect(appimage_service.get_data_root()).toBe(home_data_root);
    expect(blocked_service.get_data_root()).toBe(home_data_root);
  });

  it("未知提示词任务类型不会生成资源路径", () => {
    const app_root = create_temp_root("linguagacha-path-invalid-prompt-");
    const service = new AppPathService({
      appRoot: app_root,
      builtinRoot: path.join(app_root, "builtin"),
      env: {},
      platform: "win32",
    });

    expect(() => service.get_prompt_template_dir("proofreading", "zh")).toThrow(
      "runtime.internal_invariant",
    );
  });
});

describe("resolve_preset_file", () => {
  it("按虚拟来源解析受控根目录并显式兼容旧 JSON 命名空间", () => {
    const builtin_directory = path.join("builtin", "glossary", "preset");
    const user_directory = path.join("userdata", "glossary");

    expect(
      resolve_preset_file({
        virtual_id: "user:demo.json",
        extension: ".json",
        builtin_directory,
        user_directory,
      }),
    ).toEqual({
      source: "user",
      file_name: "demo.json",
      file_path: path.join(user_directory, "demo.json"),
    });
    expect(
      resolve_preset_file({
        virtual_id: "builtin:glossary:demo.json",
        extension: ".json",
        builtin_directory,
        user_directory,
        allow_legacy_namespace: true,
      }),
    ).toEqual({
      source: "builtin",
      file_name: "demo.json",
      file_path: path.join(builtin_directory, "demo.json"),
    });
    expect(() =>
      resolve_preset_file({
        virtual_id: "builtin:glossary:demo.json",
        extension: ".json",
        builtin_directory,
        user_directory,
      }),
    ).toThrow("request.validation_failed");
  });

  it.each([
    "builtin:../demo.txt",
    "builtin:folder/demo.txt",
    "builtin:folder\\demo.txt",
    "builtin:/demo.txt",
    "builtin:C:\\demo.txt",
    "external:demo.txt",
    "builtin:demo.json",
  ])("拒绝逃逸、绝对路径、未知来源或错误扩展名：%s", (virtual_id) => {
    expect(() =>
      resolve_preset_file({
        virtual_id,
        extension: ".txt",
        builtin_directory: "builtin-root",
        user_directory: "user-root",
      }),
    ).toThrow("request.validation_failed");
  });
});

/**
 * 创建测试临时根目录，避免触碰真实应用目录。
 */
function create_temp_root(prefix: string): string {
  const temp_root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup_roots.push(temp_root);
  return temp_root;
}

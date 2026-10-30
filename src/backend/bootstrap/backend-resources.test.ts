import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTING } from "../../domain/setting";
import { ProjectDatabase } from "../database/database-operations";
import { LogManager } from "../log/log-manager";
import { ProxyHttpClient } from "../network/proxy-http-client";
import { BackendResources } from "./backend-resources";

let app_root = "";

beforeEach(() => {
  app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-backend-resources-"));
  fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3", "utf8");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(app_root, { recursive: true, force: true });
});

describe("BackendResources", () => {
  it("启动后交付共享资源，关闭时恢复全局网络入口", async () => {
    const original_fetch = globalThis.fetch;
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const resources = await BackendResources.start(create_options());

    try {
      expect(resources.metadata.read_version()).toBe("1.2.3");
      const project_path = path.join(app_root, "version.lg");
      fs.writeFileSync(path.join(app_root, "version.txt"), "9.0.0");
      await resources.database.create_project(project_path, "version");
      expect((await resources.database.get_all_meta(project_path)).target_app_version).toBe(
        "1.2.3",
      );
      expect(globalThis.fetch).not.toBe(original_fetch);
    } finally {
      await resources.dispose(); // 断言失败时也恢复全局网络入口，避免影响后续用例。
    }

    expect(globalThis.fetch).toBe(original_fetch);
    expect(database_close).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "启动只读取当前配置并保留旧配置、预设和技能文件，当前配置存在：%s",
    async (has_current_config) => {
      const legacy_files = {
        "config.json": '{"activate_model_id":"old-root"}',
        "resource/config.json": '{"activate_model_id":"old-resource"}',
        "resource/preset/custom_prompt/user/zh/mine.txt": "旧提示词",
        "resource/preset/glossary/user/mine.json": "[]",
        "userdata/agent/skill/fixture/SKILL.md": "旧技能",
      };
      for (const [relative_path, content] of Object.entries(legacy_files)) {
        const file_path = path.join(app_root, relative_path);
        fs.mkdirSync(path.dirname(file_path), { recursive: true });
        fs.writeFileSync(file_path, content);
      }
      const config = JSON.stringify(
        {
          activate_model_id: "legacy",
          glossary_default_preset: "resource/preset/glossary/user/mine.json",
          text_preserve_default_preset: "builtin:zh:base.json",
        },
        null,
        2,
      );
      if (has_current_config)
        fs.writeFileSync(path.join(app_root, "userdata", "config.json"), config);

      const resources = await BackendResources.start(create_options());
      try {
        expect(resources.settings.read_setting()["model_selection"]).toEqual(
          DEFAULT_SETTING.model_selection,
        );
        if (has_current_config)
          expect(fs.readFileSync(resources.paths.get_config_path(), "utf8")).toBe(config);
        else expect(fs.existsSync(resources.paths.get_config_path())).toBe(false);
        expect(fs.existsSync(resources.paths.get_prompt_user_preset_dir())).toBe(false);
        expect(fs.existsSync(resources.paths.get_quality_rule_user_preset_dir("glossary"))).toBe(
          false,
        );
        expect(fs.existsSync(resources.paths.get_agent_user_skill_dir())).toBe(false);
        for (const [relative_path, content] of Object.entries(legacy_files)) {
          expect(fs.readFileSync(path.join(app_root, relative_path), "utf8")).toBe(content);
        }
      } finally {
        await resources.dispose();
      }
    },
  );

  it("启动后段失败时释放 transport、数据库和日志", async () => {
    const failure = new Error("transport install failed");
    vi.spyOn(ProxyHttpClient.prototype, "install_as_global_fetch").mockImplementationOnce(() => {
      throw failure;
    });
    const transport_dispose = vi.spyOn(ProxyHttpClient.prototype, "dispose");
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const log_shutdown = vi.spyOn(LogManager.prototype, "shutdown");

    await expect(BackendResources.start(create_options())).rejects.toBe(failure);

    expect(transport_dispose).toHaveBeenCalledOnce();
    expect(database_close).toHaveBeenCalledOnce();
    expect(log_shutdown).toHaveBeenCalledOnce();
  });
});

/** 用临时安装根启动真实资源，关闭控制台和窗口日志。 */
function create_options() {
  return {
    appRoot: app_root,
    builtinRoot: path.resolve(process.cwd(), "builtin"),
    logTargets: { console: false, window: false },
    proxyResolver: { resolveProxy: async () => "DIRECT" },
  };
}

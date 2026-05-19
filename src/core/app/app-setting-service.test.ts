import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../api/api-types";
import { JsonTool } from "../../shared/utils/json-tool";
import { AppPathService } from "./app-path-service";
import { AppSettingService } from "./app-setting-service";

type SettingsEvent = {
  event_type: string;
  payload: Record<string, ApiJsonValue>;
};

const cleanup_roots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  while (cleanup_roots.length > 0) {
    const temp_root = cleanup_roots.pop();
    if (temp_root !== undefined) {
      fs.rmSync(temp_root, { force: true, recursive: true });
    }
  }
});

describe("AppSettingService", () => {
  it("读取缺失设置时补齐快照并把完整设置文件落到 userdata/config.json", () => {
    const { service, config_path } = create_service();

    const result = service.get_app_settings();
    const saved = read_config(config_path);

    expect(result["settings"]).toMatchObject({
      app_language: "ZH",
      source_language: "JA",
      target_language: "ZH",
      recent_projects: [],
    });
    expect(result["settings"]).not.toHaveProperty("models");
    expect(saved).toMatchObject({
      app_language: "ZH",
      activate_model_id: "",
      models: null,
    });
  });

  it("更新应用设置时只写白名单字段并发布 settings.changed 快照", async () => {
    const { service, config_path, events } = create_service();
    write_config(config_path, {
      app_language: "ZH",
      activate_model_id: "model-1",
      models: [{ id: "model-1" }],
      unknown_key: "不应保留",
    });

    const result = await service.update_app_settings({
      app_language: "en",
      request_timeout: "45",
      project_save_mode: "FIXED",
      unknown_key: "忽略",
    });
    const saved = read_config(config_path);

    expect(result["settings"]).toMatchObject({
      app_language: "EN",
      request_timeout: 45,
      project_save_mode: "FIXED",
    });
    expect(saved).toMatchObject({
      app_language: "EN",
      request_timeout: 45,
      project_save_mode: "FIXED",
      activate_model_id: "model-1",
      models: [{ id: "model-1" }],
    });
    expect(saved).not.toHaveProperty("unknown_key");
    expect(events).toEqual([
      {
        event_type: "settings.changed",
        payload: {
          keys: ["app_language", "request_timeout", "project_save_mode"],
          settings: expect.objectContaining({
            app_language: "EN",
            request_timeout: 45,
            project_save_mode: "FIXED",
          }),
        },
      },
    ]);
  });

  it("完整设置读取使用实例级缓存且保存后刷新缓存", () => {
    const { service, config_path } = create_service();
    write_config(config_path, { app_language: "ZH" });

    expect(service.read_setting()["app_language"]).toBe("ZH");
    write_config(config_path, { app_language: "EN" });
    expect(service.read_setting()["app_language"]).toBe("ZH");

    service.save_setting({ app_language: "EN" });
    expect(service.read_setting()["app_language"]).toBe("EN");
    expect(service.read_app_language()).toBe("EN");
  });

  it("临时覆盖只影响运行期读取且不会写回 config.json", () => {
    const { service, config_path } = create_service();
    write_config(config_path, {
      source_language: "JA",
      target_language: "ZH",
      output_folder_open_on_finish: true,
    });

    service.set_transient_overrides({
      source_language: "ALL",
      target_language: "EN",
      output_folder_open_on_finish: false,
    });

    expect(service.read_setting()).toMatchObject({
      source_language: "ALL",
      target_language: "EN",
      output_folder_open_on_finish: false,
    });
    expect(read_config(config_path)).toMatchObject({
      source_language: "JA",
      target_language: "ZH",
      output_folder_open_on_finish: true,
    });

    service.set_transient_overrides(null);

    expect(service.read_setting()).toMatchObject({
      source_language: "JA",
      target_language: "ZH",
      output_folder_open_on_finish: true,
    });
  });

  it("最近项目写入口会去重置顶、写入本地时间并发布设置事件", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 16, 9, 30, 5, 12));
    const { service, events } = create_service();

    await service.add_recent_project({ path: "E:/Novel/alpha.lg" });
    await service.add_recent_project({ path: "E:/Novel/beta.lg" });
    const add_result = await service.add_recent_project({ path: "E:/Novel/alpha.lg" });
    const remove_result = await service.remove_recent_project({ path: "E:/Novel/beta.lg" });

    expect(add_result["settings"]).toMatchObject({
      recent_projects: [
        {
          path: "E:/Novel/alpha.lg",
          name: "alpha",
          updated_at: "2026-05-16T09:30:05.012",
        },
        {
          path: "E:/Novel/beta.lg",
          name: "beta",
          updated_at: "2026-05-16T09:30:05.012",
        },
      ],
    });
    expect(remove_result["settings"]).toMatchObject({
      recent_projects: [
        {
          path: "E:/Novel/alpha.lg",
          name: "alpha",
          updated_at: "2026-05-16T09:30:05.012",
        },
      ],
    });
    expect(events.map((event) => event.payload["keys"])).toEqual([
      ["recent_projects"],
      ["recent_projects"],
      ["recent_projects"],
      ["recent_projects"],
    ]);
  });
});

function create_service(): {
  service: AppSettingService;
  config_path: string;
  events: SettingsEvent[];
} {
  const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-setting-service-"));
  cleanup_roots.push(app_root);
  const paths = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
  const events: SettingsEvent[] = [];
  const service = new AppSettingService(paths, {
    publish: (event_type, payload) => {
      events.push({ event_type, payload });
    },
  });
  return { service, config_path: paths.get_config_path(), events };
}

function read_config(config_path: string): Record<string, ApiJsonValue> {
  return JsonTool.parseStrict(fs.readFileSync(config_path, "utf-8")) as Record<
    string,
    ApiJsonValue
  >;
}

function write_config(config_path: string, payload: Record<string, ApiJsonValue>): void {
  fs.mkdirSync(path.dirname(config_path), { recursive: true });
  fs.writeFileSync(config_path, JsonTool.stringifyStrict(payload), "utf-8");
}

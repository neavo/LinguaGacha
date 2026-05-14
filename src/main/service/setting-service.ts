import fs from "node:fs";
import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import { AppPathService } from "./path-service";
import { JsonTool } from "../../shared/utils/json-tool";
import { Setting } from "../../base/setting";

interface SettingsEventPublisher {
  publish: (event_type: string, payload: Record<string, ApiJsonValue>) => void; // settings.changed 是本地事件，避免设置更新绕回旧运行态同步链路
}

/**
 * 封装应用设置与最近项目设置文件的唯一写入口
 */
export class SettingService {
  private readonly paths: AppPathService;
  private readonly event_publisher: SettingsEventPublisher | null;

  /**
   * 初始化 SettingService 依赖，保持外部写入口清晰
   */
  public constructor(paths: AppPathService, event_publisher: SettingsEventPublisher | null = null) {
    this.paths = paths;
    this.event_publisher = event_publisher;
  }

  /**
   * 读取应用设置快照，保持 UI 只消费白名单字段
   */
  public get_app_settings(): Record<string, ApiJsonValue> {
    const setting = this.load_setting();
    this.save_setting(setting);
    return { settings: Setting.from_json(setting).to_snapshot() as Record<string, ApiJsonValue> };
  }

  /**
   * 更新应用设置白名单字段，并通过 TS 事件 hub 广播设置变化
   */
  public async update_app_settings(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    let setting = Setting.from_json(this.load_setting());
    const changed_keys: string[] = [];
    for (const [key, value] of Object.entries(request)) {
      const next_setting = setting.with_setting_value(key, value);
      if (next_setting === setting) continue;
      setting = next_setting;
      changed_keys.push(key);
    }
    if (changed_keys.length > 0) {
      this.save_setting(setting.to_json() as Record<string, ApiJsonValue>);
      this.publish_settings_changed(
        changed_keys,
        setting.to_json() as Record<string, ApiJsonValue>,
      );
    }
    return { settings: setting.to_snapshot() as Record<string, ApiJsonValue> };
  }

  /**
   * 写入最近项目列表，集中去重和数量限制
   */
  public async add_recent_project(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const project_path = typeof request["path"] === "string" ? request["path"] : "";
    let setting = Setting.from_json(this.load_setting());
    if (project_path !== "") {
      setting = setting.with_recent_project_added(project_path, this.build_local_iso_timestamp());
      this.save_setting(setting.to_json() as Record<string, ApiJsonValue>);
      this.publish_settings_changed(
        ["recent_projects"],
        setting.to_json() as Record<string, ApiJsonValue>,
      );
    }
    return { settings: setting.to_snapshot() as Record<string, ApiJsonValue> };
  }

  /**
   * 移除最近项目，保持配置文件列表结构稳定
   */
  public async remove_recent_project(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const project_path = typeof request["path"] === "string" ? request["path"] : "";
    let setting = Setting.from_json(this.load_setting());
    if (project_path !== "") {
      setting = setting.with_recent_project_removed(project_path);
      this.save_setting(setting.to_json() as Record<string, ApiJsonValue>);
      this.publish_settings_changed(
        ["recent_projects"],
        setting.to_json() as Record<string, ApiJsonValue>,
      );
    }
    return { settings: setting.to_snapshot() as Record<string, ApiJsonValue> };
  }

  /**
   * 读取设置文件并补齐默认值，兼容旧 userdata
   */
  public load_setting(): Record<string, ApiJsonValue> {
    const config_path = this.paths.get_config_path();
    let payload: unknown = {};
    if (fs.existsSync(config_path)) {
      payload = JsonTool.parseStrict(fs.readFileSync(config_path)) as unknown;
    }
    return Setting.from_json(payload).to_json() as Record<string, ApiJsonValue>;
  }

  /**
   * 持久化设置对象，确保目录存在后再写入
   */
  public save_setting(setting: Record<string, ApiJsonValue>): void {
    const config_path = this.paths.get_config_path();
    fs.mkdirSync(path.dirname(config_path), { recursive: true });
    fs.writeFileSync(
      config_path,
      JsonTool.stringifyStrict(Setting.from_json(setting).to_json(), { indent: 4 }),
      "utf-8",
    );
  }

  /**
   * 构建设置响应快照，隔离 config.json 内部形状
   */
  public build_setting_snapshot(
    setting: Record<string, ApiJsonValue>,
  ): Record<string, ApiJsonValue> {
    return Setting.from_json(setting).to_snapshot() as Record<string, ApiJsonValue>;
  }

  /**
   * 设置广播直接接发布，后续任务读取配置文件即可看到最新值
   */
  private publish_settings_changed(
    changed_keys: string[],
    setting: Record<string, ApiJsonValue>,
  ): void {
    this.event_publisher?.publish("settings.changed", {
      keys: changed_keys as unknown as ApiJsonValue,
      settings: this.build_setting_snapshot(setting),
    });
  }

  /**
   * 生成本地时区时间戳，保持最近项目排序可读
   */
  private build_local_iso_timestamp(): string {
    const now = new Date();
    const pad = (value: number): string => value.toString().padStart(2, "0");
    const year = now.getFullYear().toString().padStart(4, "0");
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    const milliseconds = now.getMilliseconds().toString().padStart(3, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`;
  }
}

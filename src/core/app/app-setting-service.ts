import type { ApiJsonValue } from "../api/api-types";
import { AppPathService } from "./app-path-service";
import { JsonTool } from "../../shared/utils/json-tool";
import { Setting } from "../../base/setting";
import { NativeFs, default_native_fs } from "../../native/native-fs";

interface AppSettingsStreamPublisher {
  publish: (topic: string, payload: Record<string, ApiJsonValue>) => void; // settings.changed 走公开 stream topic，避免设置更新绕回旧运行态同步链路
}

/**
 * AppSettingService 是 userdata/config.json 的运行期唯一读写入口。
 */
export class AppSettingService {
  private readonly paths: AppPathService; // paths 提供 config.json 的唯一落点
  private stream_publisher: AppSettingsStreamPublisher | null; // stream_publisher 只广播 settings.changed
  private readonly native_fs: NativeFs; // native_fs 统一设置文件读写和长路径策略
  private setting_cache: Setting | null = null; // setting_cache 是运行期配置事实，外部手改不做热加载
  private transient_overrides: Record<string, ApiJsonValue> | null = null; // transient_overrides 只服务 CLI 单次任务，不写回 config.json

  /**
   * 初始化 AppSettingService 依赖，保持配置写入口与事件出口清晰。
   */
  public constructor(
    paths: AppPathService,
    stream_publisher: AppSettingsStreamPublisher | null = null,
    native_fs: NativeFs = default_native_fs,
  ) {
    this.paths = paths;
    this.stream_publisher = stream_publisher;
    this.native_fs = native_fs;
  }

  /**
   * 绑定运行期 stream 出口；Gateway 生命周期重建 stream hub 时只更新这个引用。
   */
  public set_stream_publisher(stream_publisher: AppSettingsStreamPublisher | null): void {
    this.stream_publisher = stream_publisher;
  }

  /**
   * 设置同进程入口的临时覆盖值；CLI 语言参数需要影响任务快照，但不能改写 GUI 配置文件。
   */
  public set_transient_overrides(overrides: Record<string, ApiJsonValue> | null): void {
    this.transient_overrides = overrides === null ? null : { ...overrides };
  }

  /**
   * 读取应用设置快照，保持 UI 只消费白名单字段
   */
  public get_app_settings(): Record<string, ApiJsonValue> {
    const setting = this.read_setting_entity();
    this.save_setting(setting.to_json() as Record<string, ApiJsonValue>);
    return { settings: setting.to_snapshot() as Record<string, ApiJsonValue> };
  }

  /**
   * 更新应用设置白名单字段，并通过 API stream 广播设置变化
   */
  public async update_app_settings(
    request: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    let setting = this.read_setting_entity();
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
    let setting = this.read_setting_entity();
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
    let setting = this.read_setting_entity();
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
   * 读取完整设置对象副本，业务服务不能直接触碰 config.json。
   */
  public read_setting(): Record<string, ApiJsonValue> {
    const setting = this.read_setting_entity().to_json() as Record<string, ApiJsonValue>;
    if (this.transient_overrides === null) {
      return setting;
    }
    return { ...setting, ...this.transient_overrides };
  }

  /**
   * 持久化完整设置对象，并同步刷新运行期缓存。
   */
  public save_setting(setting: Record<string, ApiJsonValue>): void {
    const config_path = this.paths.get_config_path();
    const normalized_setting = Setting.from_json(setting);
    this.native_fs.write_file_sync(
      config_path,
      JsonTool.stringifyStrict(normalized_setting.to_json(), { indent: 4 }),
    );
    this.setting_cache = normalized_setting;
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
   * 读取当前应用语言，日志和错误文案只消费这个窄入口。
   */
  public read_app_language(): ApiJsonValue {
    return this.read_setting_entity().to_json()["app_language"] ?? "ZH";
  }

  /**
   * 从缓存或磁盘读取设置实体；磁盘读取只在服务生命周期内发生一次。
   */
  private read_setting_entity(): Setting {
    if (this.setting_cache !== null) {
      return this.setting_cache;
    }
    const config_path = this.paths.get_config_path();
    let payload: unknown = {};
    if (this.native_fs.exists(config_path)) {
      payload = JsonTool.parseStrict(this.native_fs.read_file(config_path)) as unknown;
    }
    this.setting_cache = Setting.from_json(payload);
    return this.setting_cache;
  }

  /**
   * 设置广播直接接发布，后续任务读取服务缓存即可看到最新值。
   */
  private publish_settings_changed(
    changed_keys: string[],
    setting: Record<string, ApiJsonValue>,
  ): void {
    this.stream_publisher?.publish("settings.changed", {
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

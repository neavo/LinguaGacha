import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";
import type { LocaleKey } from "@frontend/app/locale/locale-context";
import {
  PROXY_MODES,
  PROXY_PROTOCOLS,
  PROJECT_SAVE_MODES,
  read_proxy_setting,
  type ProjectSaveMode,
  type ProxyMode,
  type ProxySettingField,
  type ProxySettingValue,
} from "@domain/setting";

export type { ProjectSaveMode, ProxyMode, ProxySettingValue };

/** 请求超时输入框接受的后端协议边界。 */
export const REQUEST_TIMEOUT_MIN = 0;
export const REQUEST_TIMEOUT_MAX = 9_999_999;

export type BasicSettingsSnapshot = Pick<
  SettingsSnapshot,
  | "project_save_mode"
  | "project_fixed_path"
  | "output_folder_open_on_finish"
  | "request_timeout"
  | "proxy"
>;

/** 保存模式的协议值到本地化文案映射。 */
export const PROJECT_SAVE_MODE_LABEL_KEYS: Readonly<Record<ProjectSaveMode, LocaleKey>> = {
  MANUAL: "basic_settings_page.fields.project_save_mode.options.manual",
  FIXED: "basic_settings_page.fields.project_save_mode.options.fixed",
  SOURCE: "basic_settings_page.fields.project_save_mode.options.source",
};

/** 保持选项顺序与领域协议声明一致。 */
export const PROJECT_SAVE_MODE_OPTIONS = PROJECT_SAVE_MODES;

/** 代理模式文案与后端日志共用同一组键。 */
export const PROXY_MODE_LABEL_KEYS: Readonly<Record<ProxyMode, LocaleKey>> = {
  direct: "app.proxy.mode.direct",
  system: "app.proxy.mode.system",
  manual: "app.proxy.mode.manual",
};

/** 代理模式与协议选项顺序与领域协议一致。 */
export const PROXY_MODE_OPTIONS = PROXY_MODES;
export const PROXY_PROTOCOL_OPTIONS = PROXY_PROTOCOLS;

/**
 * 从完整设置快照截取本页拥有的字段，供草稿比较与失败回滚使用。
 */
export function build_basic_settings_snapshot(
  settings_snapshot: SettingsSnapshot,
): BasicSettingsSnapshot {
  return {
    project_save_mode: settings_snapshot.project_save_mode,
    project_fixed_path: settings_snapshot.project_fixed_path,
    output_folder_open_on_finish: settings_snapshot.output_folder_open_on_finish,
    request_timeout: settings_snapshot.request_timeout,
    proxy: settings_snapshot.proxy,
  };
}

/** 在 DOM 字符串值进入设置协议前收窄保存模式。 */
export function is_project_save_mode(candidate: string): candidate is ProjectSaveMode {
  return PROJECT_SAVE_MODES.includes(candidate as ProjectSaveMode);
}

/** 手动草稿的校验与后端保存校验共用同一入口，界面据此定位字段。 */
export function read_proxy_incomplete_field(draft: ProxySettingValue): ProxySettingField | null {
  return read_proxy_setting(draft).incomplete_field;
}

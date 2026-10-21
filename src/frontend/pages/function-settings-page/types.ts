import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";
import type { LocaleKey } from "@frontend/app/locale/locale-context";
import { PROJECT_SAVE_MODES, type ProjectSaveMode } from "@domain/setting";

export type { ProjectSaveMode };

/** 请求超时输入框接受的后端协议边界。 */
export const REQUEST_TIMEOUT_MIN = 0;
export const REQUEST_TIMEOUT_MAX = 9_999_999;

export type FunctionSettingsSnapshot = Pick<
  SettingsSnapshot,
  | "preceding_lines_threshold"
  | "following_lines_threshold"
  | "project_save_mode"
  | "project_fixed_path"
  | "output_folder_open_on_finish"
  | "request_timeout"
>;

/** 保存模式的协议值到本地化文案映射。 */
export const PROJECT_SAVE_MODE_LABEL_KEYS: Readonly<Record<ProjectSaveMode, LocaleKey>> = {
  MANUAL: "function_settings_page.fields.project_save_mode.options.manual",
  FIXED: "function_settings_page.fields.project_save_mode.options.fixed",
  SOURCE: "function_settings_page.fields.project_save_mode.options.source",
};

/** 保持选项顺序与领域协议声明一致。 */
export const PROJECT_SAVE_MODE_OPTIONS = PROJECT_SAVE_MODES;

/**
 * 从完整设置快照截取本页拥有的字段，供草稿比较与失败回滚使用。
 */
export function build_function_settings_snapshot(
  settings_snapshot: SettingsSnapshot,
): FunctionSettingsSnapshot {
  return {
    project_save_mode: settings_snapshot.project_save_mode,
    project_fixed_path: settings_snapshot.project_fixed_path,
    output_folder_open_on_finish: settings_snapshot.output_folder_open_on_finish,
    request_timeout: settings_snapshot.request_timeout,
    preceding_lines_threshold: settings_snapshot.preceding_lines_threshold,
    following_lines_threshold: settings_snapshot.following_lines_threshold,
  };
}

/** 在 DOM 字符串值进入设置协议前收窄保存模式。 */
export function is_project_save_mode(candidate: string): candidate is ProjectSaveMode {
  return PROJECT_SAVE_MODES.includes(candidate as ProjectSaveMode);
}

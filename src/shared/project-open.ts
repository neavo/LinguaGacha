import { parse_app_version } from "./app-version";

export type ProjectOpenRequest = {
  path: string;
  confirmed_target_app_version?: string; // 确认绑定具体版本，重试仍需重新检查工程。
};

export type ProjectVersionConfirmation = {
  target_app_version: string;
  current_app_version: string;
};

/** 确认对象只消费后端规范版本，避免将错误详情中的任意值发回。 */
export function read_project_version_confirmation(
  value: unknown,
): ProjectVersionConfirmation | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("target_app_version" in value) || !("current_app_version" in value)) return null;
  const target = parse_app_version(value.target_app_version);
  const current = parse_app_version(value.current_app_version);
  if (
    !target ||
    !current ||
    target.value !== value.target_app_version ||
    current.value !== value.current_app_version
  )
    return null;
  return { target_app_version: target.value, current_app_version: current.value };
}

import { app_error_message_key, is_app_error_code } from "@shared/error";
import type { LocaleKey } from "@shared/i18n";

type DesktopApiErrorLike = Error & {
  code: string;
  details: Record<string, unknown>;
};

export type VisibleErrorTextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

/**
 * 普通页面错误展示只消费 DesktopApiError 的稳定 code，其他异常退回页面语境文案。
 */
export function resolve_visible_error_message(
  error: unknown,
  text: VisibleErrorTextResolver,
  fallback_message: string,
): string {
  if (is_desktop_api_error_like(error)) {
    const message_key = is_app_error_code(error.code)
      ? app_error_message_key(error.code)
      : (`app.error.desktop.${error.code}.message` as LocaleKey);
    const resolved_message = text(message_key, error_details_to_i18n_params(error.details));
    return resolved_message === message_key ? fallback_message : resolved_message;
  }

  // 非 DesktopApiError 的 message 只作为诊断事实保留，普通页面不直接展示本地异常文本。
  return fallback_message;
}

/** 结构判定避免反馈层反向依赖 transport 实例，同时不读取 Error.message。 */
function is_desktop_api_error_like(error: unknown): error is DesktopApiErrorLike {
  return (
    error instanceof Error &&
    error.name === "DesktopApiError" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { details?: unknown }).details === "object" &&
    (error as { details?: unknown }).details !== null
  );
}

/**
 * 错误 details 进入 i18n 参数前统一字符串化，保持页面和 Gateway 参数口径一致。
 */
function error_details_to_i18n_params(details: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key.toUpperCase(), String(value ?? "")]),
  );
}

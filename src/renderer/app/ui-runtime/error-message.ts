import type { LocaleKey } from "@shared/i18n";

type DesktopApiErrorLike = Error & {
  details: Record<string, unknown>;
  message_key: string | null;
};

export type VisibleErrorTextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

/**
 * 普通页面错误展示只消费 DesktopApiError 的稳定 key，其他异常统一退回页面语境文案。
 */
export function resolve_visible_error_message(
  error: unknown,
  text: VisibleErrorTextResolver,
  fallback_message: string,
): string {
  if (is_desktop_api_error_like(error)) {
    if (error.message_key !== null) {
      const resolved_message = text(
        error.message_key as LocaleKey,
        error_details_to_i18n_params(error.details),
      );
      if (resolved_message !== error.message_key) {
        return resolved_message;
      }
    }

    const safe_message = error.message.trim();
    return safe_message === "" || safe_message === error.message_key
      ? fallback_message
      : safe_message;
  }

  // 非 DesktopApiError 的 message 只作为诊断事实保留，普通页面不直接展示本地异常文本。
  return fallback_message;
}

/**
 * DesktopApiError-like 判断只依赖公开字段，避免 UI runtime 反向依赖具体模块实例。
 */
function is_desktop_api_error_like(error: unknown): error is DesktopApiErrorLike {
  return (
    error instanceof Error &&
    error.name === "DesktopApiError" &&
    typeof (error as { message_key?: unknown }).message_key !== "undefined" &&
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

import type { LocaleKey } from "@shared/i18n";

type DesktopApiErrorLike = Error & {
  details: Record<string, unknown>;
  message_key: string | null;
};

export type VisibleErrorTextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

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

  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return fallback_message;
}

function is_desktop_api_error_like(error: unknown): error is DesktopApiErrorLike {
  return (
    error instanceof Error &&
    error.name === "DesktopApiError" &&
    typeof (error as { message_key?: unknown }).message_key !== "undefined" &&
    typeof (error as { details?: unknown }).details === "object" &&
    (error as { details?: unknown }).details !== null
  );
}

function error_details_to_i18n_params(details: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key.toUpperCase(), String(value ?? "")]),
  );
}

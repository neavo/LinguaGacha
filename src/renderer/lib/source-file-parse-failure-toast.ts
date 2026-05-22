import type { TextResolver } from "@shared/i18n";
import {
  format_source_file_parse_failure_notice,
  normalize_source_file_parse_failures,
  type SourceFileParseFailureRecord,
} from "@shared/source-file-parse-failure";

/**
 * 将 API 动态失败列表整理成页面可直接展示的完整 Toast 文案。
 */
export function format_source_file_parse_failure_toast(args: {
  value: unknown;
  text: TextResolver;
}): string | null {
  const failures = normalize_source_file_parse_failures(args.value);
  if (failures.length === 0) {
    return null;
  }
  return format_source_file_parse_failure_notice({
    failures,
    text: args.text,
  });
}

/**
 * API 错误明细里若包含 failed_files，则优先作为阻断原因展示。
 */
export function format_source_file_parse_failure_error_toast(args: {
  error: unknown;
  text: TextResolver;
}): string | null {
  return format_source_file_parse_failure_toast({
    value: read_failed_files_from_error(args.error),
    text: args.text,
  });
}

/**
 * 解析失败详情只从 DesktopApiError-like 的公开 details 读取，不解析 Error.message。
 */
function read_failed_files_from_error(error: unknown): SourceFileParseFailureRecord[] {
  if (
    typeof error !== "object" ||
    error === null ||
    !("details" in error) ||
    typeof (error as { details?: unknown }).details !== "object" ||
    (error as { details?: unknown }).details === null
  ) {
    return [];
  }
  const details = (error as { details: Record<string, unknown> }).details;
  return normalize_source_file_parse_failures(details["failed_files"]);
}

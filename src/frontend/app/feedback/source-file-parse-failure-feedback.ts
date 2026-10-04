import { is_json_record } from "@domain/json";
import {
  format_source_file_parse_failure_notice,
  normalize_source_file_parse_failures,
} from "@shared/source-file-parse-failure";

/**
 * 将 API 动态失败列表整理成页面可直接展示的完整 Toast 文案。
 */
export function format_source_file_parse_failure_toast(value: unknown): string | null {
  const failures = normalize_source_file_parse_failures(value);
  return failures.length === 0 ? null : format_source_file_parse_failure_notice(failures);
}

/**
 * API 错误明细里若包含 failed_files，则优先作为阻断原因展示。
 */
export function format_source_file_parse_failure_error_toast(error: unknown): string | null {
  if (!is_json_record(error) || !is_json_record(error["details"])) return null;
  return format_source_file_parse_failure_toast(error["details"]["failed_files"]);
}

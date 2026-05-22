import path from "node:path";

import type { LogManager } from "../log/log-manager";
import * as AppErrors from "../../shared/error";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";
import { format_source_file_parse_failure_notice } from "../../shared/source-file-parse-failure";
import type { TextResolver } from "../../shared/i18n";

/**
 * 将格式解析异常转成统一失败记录，保证项目创建和工作台导入共用同一份报告语义。
 */
export function build_source_file_parse_failure(args: {
  source_path: string;
  rel_path: string;
  error: unknown;
}): SourceFileParseFailureRecord {
  const app_error = normalize_source_file_parse_error(args.error);
  return {
    source_path: args.source_path,
    rel_path: args.rel_path,
    filename: path.basename(args.source_path),
    code: app_error.code,
    message_key: app_error.message_key,
  };
}

/**
 * 写出完整失败报告日志；Toast 和日志保持同一套逐文件原因文案。
 */
export function log_source_file_parse_failures(args: {
  failures: SourceFileParseFailureRecord[];
  log_manager: Pick<LogManager, "warning"> | null;
  source: string;
  text: TextResolver;
}): void {
  if (args.failures.length === 0 || args.log_manager === null) {
    return;
  }
  args.log_manager.warning(
    format_source_file_parse_failure_notice({
      failures: args.failures,
      text: args.text,
    }),
    {
      source: args.source,
      context: {
        failed_files: args.failures.map((failure) => ({
          source_path: failure.source_path,
          rel_path: failure.rel_path,
          code: failure.code,
          message_key: failure.message_key,
        })),
      },
    },
  );
}

/**
 * 源文件解析失败只暴露稳定错误码；底层 Error 留在日志 cause 或诊断上下文里。
 */
function normalize_source_file_parse_error(error: unknown): AppErrors.AppError {
  if (AppErrors.is_app_error(error)) {
    return error;
  }
  if (error instanceof SyntaxError) {
    return new AppErrors.FileParseFailedError({ cause: error });
  }
  if (read_node_error_code(error) === "ENOENT") {
    return new AppErrors.FileNotFoundError({ cause: error });
  }
  return new AppErrors.FileIoFailedError({ cause: error });
}

/**
 * Node 风格错误码只在 Core 边界识别，避免格式处理器直接依赖具体异常类。
 */
function read_node_error_code(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

import path from "node:path";
import type { SourceFileParseWarning } from "./file-format-types";

import type { LogManager } from "../log/log-manager";
import * as AppErrors from "../../shared/error";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";

/** 来源级失败保留原始异常，日志据此记录完整原因链。 */
export type SourceFileFailure = Readonly<{
  source_path: string;
  rel_path: string;
  error: unknown;
}>;

/** 失败回执保留已经完成的目录副作用，保存数量只取实际提交事实。 */
export function source_operation_error(
  error: unknown,
  directory_changes: readonly string[],
  saved_assets = 0,
): AppErrors.AppError {
  const original = AppErrors.is_app_error(error) ? error : null;
  if (original?.public_details?.source_operation !== undefined) return original;
  return new AppErrors.AppError(original?.code ?? "file.io_failed", {
    cause: error,
    public_details: {
      ...original?.public_details,
      source_operation: { saved_assets, directory_changes: [...directory_changes] },
    },
  });
}

/** 预览阶段把来源发现失败转成公开记录，正式操作的失败只进入日志。 */
export function build_source_file_parse_failure(
  args: SourceFileFailure,
): SourceFileParseFailureRecord {
  const app_error = normalize_source_file_parse_error(args.error);
  return {
    source_path: args.source_path,
    rel_path: args.rel_path,
    filename: path.basename(args.source_path),
    code: app_error.code,
    message: app_error.message,
  };
}

/** 每个来源失败和每个局部遗漏各记一条日志，由操作拥有者调用一次。 */
export function log_source_file_diagnostics(args: {
  failures: readonly SourceFileFailure[];
  warnings: readonly SourceFileParseWarning[];
  log_manager: Pick<LogManager, "warning"> | null;
  source: string;
}): void {
  const { log_manager, source } = args;
  if (log_manager === null) return;
  for (const failure of args.failures) {
    const record = build_source_file_parse_failure(failure);
    log_manager.warning(record.filename + " - " + record.message, {
      source,
      error: failure.error,
      context: { source_path: record.source_path, rel_path: record.rel_path, code: record.code },
    });
  }
  for (const { error, ...warning } of args.warnings) {
    const location =
      warning.location ??
      warning.json_path?.reduce<string>(
        (result, part) => result + "[" + JSON.stringify(part) + "]",
        "$",
      ) ??
      "";
    const file = [warning.rel_path, warning.internal_file_path].filter(Boolean).join("/");
    const message = warning.diagnostics
      .map((diagnostic) => {
        const position =
          diagnostic.line === null ? "" : ":" + diagnostic.line + ":" + diagnostic.column;
        return file + " " + location + position + " - " + diagnostic.message;
      })
      .join("\n");
    log_manager.warning(message, { source, error, context: { warning } });
  }
}

/**
 * 源文件解析失败保留具体原因，稳定错误码供程序分类。
 */
function normalize_source_file_parse_error(error: unknown): AppErrors.AppError {
  if (AppErrors.is_app_error(error)) {
    return error;
  }
  if (error instanceof SyntaxError) {
    return new AppErrors.AppError("file.parse_failed", { cause: error });
  }
  if (read_node_error_code(error) === "ENOENT") {
    return new AppErrors.AppError("file.not_found", { cause: error });
  }
  return new AppErrors.AppError("file.io_failed", { cause: error });
}

/**
 * Node 风格错误码只在 Backend 边界识别，避免格式处理器直接依赖具体异常类。
 */
function read_node_error_code(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

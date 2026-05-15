import { AppError, type AppErrorPublicDetails } from "../app-error";

/**
 * FileNotFoundError 表达受控文件缺失，不携带内部绝对路径。
 */
export class FileNotFoundError extends AppError {
  /**
   * 调用方只能把 rel_path 或 filename 这类安全字段放入 public_details。
   */
  public constructor(args: { public_details?: AppErrorPublicDetails; cause?: unknown } = {}) {
    super({ code: "file.not_found", ...args });
  }
}

/**
 * UnsupportedFileFormatError 表示文件域格式适配器无法承接输入。
 */
export class UnsupportedFileFormatError extends AppError {
  /**
   * 格式失败原因如需排查应进入 cause 或 diagnostic context。
   */
  public constructor(args: { public_details?: AppErrorPublicDetails; cause?: unknown } = {}) {
    super({ code: "file.unsupported_format", ...args });
  }
}

/**
 * FileIoFailedError 包装读写失败，公开层只展示安全摘要。
 */
export class FileIoFailedError extends AppError {
  /**
   * Node 原始异常作为 cause 保留，避免路径和系统信息进入 envelope。
   */
  public constructor(
    args: {
      public_details?: AppErrorPublicDetails;
      diagnostic_context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super({ code: "file.io_failed", ...args });
  }
}

import { AppError, type AppErrorArgs } from "../app-error";

/**
 * FileNotFoundError 表达受控文件缺失，不携带内部绝对路径。
 */
export class FileNotFoundError extends AppError {
  /**
   * 调用方只能把 rel_path 或 filename 这类安全字段放入 public_details。
   */
  public constructor(args: AppErrorArgs = {}) {
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
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "file.unsupported_format", ...args });
  }
}

/**
 * FileParseFailedError 表示文件格式已识别，但内容无法按该格式解析。
 */
export class FileParseFailedError extends AppError {
  /**
   * parser、format 这类安全定位信息进入 details，底层解析异常保留在 cause。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "file.parse_failed", ...args });
  }
}

/**
 * InvalidFileStructureError 表示文件可读取，但缺少格式契约要求的内部结构。
 */
export class InvalidFileStructureError extends AppError {
  /**
   * 结构定位只放安全字段或诊断上下文，避免把内部对象穿过 API 边界。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "file.invalid_structure", ...args });
  }
}

/**
 * FileIoFailedError 包装读写失败，公开层只展示安全摘要。
 */
export class FileIoFailedError extends AppError {
  /**
   * Node 原始异常作为 cause 保留，避免路径和系统信息进入 envelope。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "file.io_failed", ...args });
  }
}

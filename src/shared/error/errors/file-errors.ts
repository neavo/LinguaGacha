import { AppError, type AppErrorArgs } from "../app-error";

/** 受控文件缺失，公开层不得携带内部绝对路径。 */
export class FileNotFoundError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "file.not_found", ...args });
  }
}

/** 已知文件格式不在当前适配器支持范围内。 */
export class UnsupportedFileFormatError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "file.unsupported_format", ...args });
  }
}

/** 格式已识别但内容解析失败，原始解析异常保留在 cause。 */
export class FileParseFailedError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "file.parse_failed", ...args });
  }
}

/** 文件可读取但缺少格式契约要求的内部结构。 */
export class InvalidFileStructureError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "file.invalid_structure", ...args });
  }
}

/** 包装文件读写失败，对外只暴露安全摘要。 */
export class FileIoFailedError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "file.io_failed", ...args });
  }
}

import { AppError } from "../app-error";

/**
 * InvalidTargetLanguageError 表示目标语言缺失或无法归一。
 */
export class InvalidTargetLanguageError extends AppError {
  /**
   * 目标语言来自公开配置，错误码本身已足够页面分支。
   */
  public constructor() {
    super({ code: "language.invalid_target_language" });
  }
}

/**
 * UnsupportedAllTargetLanguageError 表示 ALL 被误用到目标语言位置。
 */
export class UnsupportedAllTargetLanguageError extends AppError {
  /**
   * ALL 是合法源语言特殊值，但不能作为目标语言进入提示词。
   */
  public constructor() {
    super({ code: "language.unsupported_all_target_language" });
  }
}

/**
 * UnknownSourceLanguageCodeError 表示语言预过滤收到未知源语言配置。
 */
export class UnknownSourceLanguageCodeError extends AppError {
  /**
   * source_language 是公开配置短码，可作为安全 details 暴露。
   */
  public constructor(source_language: string) {
    super({
      code: "language.unknown_source_language_code",
      public_details: { source_language },
      diagnostic_context: { source_language },
    });
  }
}

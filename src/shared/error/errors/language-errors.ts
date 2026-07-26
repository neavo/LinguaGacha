import { AppError } from "../app-error";

/** 目标语言缺失或无法归一。 */
export class InvalidTargetLanguageError extends AppError {
  public constructor() {
    super({ code: "language.invalid_target_language" });
  }
}

/** ALL 只允许作为源语言特殊值，不能进入目标语言位置。 */
export class UnsupportedAllTargetLanguageError extends AppError {
  public constructor() {
    super({ code: "language.unsupported_all_target_language" });
  }
}

/** 语言预过滤收到未知源语言配置。 */
export class UnknownSourceLanguageCodeError extends AppError {
  public constructor(source_language: string) {
    super({
      code: "language.unknown_source_language_code",
      public_details: { source_language },
      diagnostic_context: { source_language },
    });
  }
}

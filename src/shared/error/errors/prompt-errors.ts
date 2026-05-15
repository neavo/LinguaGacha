import { AppError } from "../app-error";

/**
 * UnknownPromptTypeError 表示提示词槽位无法归一。
 */
export class UnknownPromptTypeError extends AppError {
  /**
   * 原始值只进入诊断上下文，防止错误 payload 扩散成公开协议。
   */
  public constructor(value: unknown) {
    super({
      code: "prompt.unknown_prompt_type",
      diagnostic_context: { value: String(value) },
    });
  }
}

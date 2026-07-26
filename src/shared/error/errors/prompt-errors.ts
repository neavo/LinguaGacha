import { AppError } from "../app-error";

/** 提示词槽位无法归一，原始值只进入诊断上下文。 */
export class UnknownPromptTypeError extends AppError {
  public constructor(value: unknown) {
    super({
      code: "prompt.unknown_prompt_type",
      diagnostic_context: { value: String(value) },
    });
  }
}

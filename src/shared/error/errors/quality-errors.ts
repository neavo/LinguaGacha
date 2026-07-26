import { AppError } from "../app-error";

/** 质量规则槽位无法归一，坏值不会扩散到公开协议。 */
export class UnknownQualityRuleTypeError extends AppError {
  public constructor(value: unknown) {
    super({
      code: "quality.unknown_rule_type",
      diagnostic_context: { value: String(value) },
    });
  }
}

/** 页面 meta key 与质量规则槽位不匹配。 */
export class UnsupportedQualityRuleMetaError extends AppError {
  public constructor(kind: string, key: string) {
    super({
      code: "quality.unsupported_rule_meta",
      diagnostic_context: { kind, key },
    });
  }
}

import { AppError } from "../app-error";

/**
 * UnknownQualityRuleTypeError 表示质量规则槽位无法归一。
 */
export class UnknownQualityRuleTypeError extends AppError {
  /**
   * 原始值只进入诊断上下文，避免把坏 payload 直接展示给用户。
   */
  public constructor(value: unknown) {
    super({
      code: "quality.unknown_rule_type",
      diagnostic_context: { value: String(value) },
    });
  }
}

/**
 * UnsupportedQualityRuleMetaError 表示页面 meta key 与规则槽位不匹配。
 */
export class UnsupportedQualityRuleMetaError extends AppError {
  /**
   * kind/key 是公开质量规则词表，可进入诊断上下文辅助定位调用点。
   */
  public constructor(kind: string, key: string) {
    super({
      code: "quality.unsupported_rule_meta",
      diagnostic_context: { kind, key },
    });
  }
}

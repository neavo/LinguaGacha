import type { QualityRuleKind } from "../../domain/quality";

/** fp 以字符长度定义，使对象投影、change 校验与运行时 contract 共享同一格式。 */
export const AGENT_WORKSPACE_FP_LENGTH = 4;

export const AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS = Object.freeze({
  glossary: ["src", "dst", "info", "case_sensitive"],
  text_preserve: ["src", "info"],
  pre_replacement: ["src", "dst", "regex", "case_sensitive"],
  post_replacement: ["src", "dst", "regex", "case_sensitive"],
} as const satisfies Record<QualityRuleKind, readonly string[]>);

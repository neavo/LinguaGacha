import type { QualityRuleKind } from "../../domain/quality";

export const AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS = Object.freeze({
  glossary: ["src", "dst", "info", "case_sensitive"],
  text_preserve: ["src", "info"],
  pre_replacement: ["src", "dst", "regex", "case_sensitive"],
  post_replacement: ["src", "dst", "regex", "case_sensitive"],
} as const satisfies Record<QualityRuleKind, readonly string[]>);

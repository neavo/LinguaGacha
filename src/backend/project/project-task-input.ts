import type { JsonRecord } from "../../domain/json";
import { Prompt, type PromptKind } from "../../domain/prompt";
import { QualityRule, type QualityRuleKind, type TextPreserveMode } from "../../domain/quality";

export type ProjectQualityRuleInput = {
  kind: QualityRuleKind; // 质量规则业务类型
  entries: JsonRecord[]; // 已归一的规则条目
  enabled: boolean | null; // null 表示该类型无启用开关
  mode: TextPreserveMode | null; // 仅 text_preserve 使用
};

export type ProjectPromptInput = {
  kind: PromptKind; // 提示词业务类型
  text: string; // 提示词正文
  enabled: boolean; // 是否启用该提示词
};

export type ProjectTaskInput = {
  quality_rules: ProjectQualityRuleInput[]; // 初始化或 CLI 注入的质量规则
  prompts: ProjectPromptInput[]; // 初始化或 CLI 注入的提示词
};

type ProjectQualityRuleStorage = Readonly<{
  database_type: string; // rules 表物理类型
  enabled_meta_key: string | null; // 启用开关 meta key
  mode_meta_key: string | null; // 文本保护模式 meta key
  revision_meta_key: string; // quality section revision key
}>;

type ProjectPromptStorage = Readonly<{
  database_type: string; // rules 表物理类型
  enabled_meta_key: string; // 启用开关 meta key
  revision_meta_key: string; // prompt revision key
}>;

/**
 * project 内部唯一的质量规则领域值到物理存储映射。
 */
export function resolve_project_quality_rule_storage(
  kind: QualityRuleKind,
): ProjectQualityRuleStorage {
  const rule = QualityRule.from_json(kind);
  return {
    database_type: rule.database_type,
    enabled_meta_key: rule.enabled_meta_key,
    mode_meta_key: rule.mode_meta_key,
    revision_meta_key: rule.revision_meta_key,
  };
}

/**
 * project 内部唯一的提示词领域值到物理存储映射。
 */
export function resolve_project_prompt_storage(kind: PromptKind): ProjectPromptStorage {
  const prompt = Prompt.from_json(kind);
  return {
    database_type: prompt.database_type,
    enabled_meta_key: prompt.enabled_meta_key,
    revision_meta_key: prompt.revision_meta_key,
  };
}

import { TRANSLATION_PROMPT } from "../../domain/prompt";
import {
  QualityRule,
  type QualityRuleEntry,
  type QualityRuleGlossaryEntry,
  type QualityRuleKind,
  type QualityRuleTextPreserveEntry,
  type QualityRuleTextReplacementEntry,
  type TextPreserveMode,
} from "../../domain/quality";

/** 任务写入边界只接收已分配项目身份的 canonical 质量规则。 */
export type ProjectQualityRuleInput =
  | {
      kind: "glossary";
      entries: QualityRuleGlossaryEntry[];
      enabled: boolean;
      mode: null;
    }
  | {
      kind: "text_preserve";
      entries: QualityRuleTextPreserveEntry[];
      enabled: null;
      mode: TextPreserveMode;
    }
  | {
      kind: "pre_replacement" | "post_replacement";
      entries: QualityRuleTextReplacementEntry[];
      enabled: boolean;
      mode: null;
    };

export type ProjectPromptInput = {
  text: string; // 提示词正文
  enabled: boolean; // 是否启用该提示词
};

export type ProjectTaskInput = {
  quality_rules: ProjectQualityRuleInput[]; // 初始化或 CLI 注入的质量规则
  translation_prompt: ProjectPromptInput | null; // 初始化或 CLI 注入的翻译提示词
};

/**
 * 将已归一的质量规则条目收窄为生命周期与 CLI 共用的项目输入。
 */
export function build_project_quality_rule_input(
  rule: QualityRule,
  entries: QualityRuleEntry[],
  enabled: boolean,
): ProjectQualityRuleInput {
  if (rule.kind === "glossary") {
    return {
      kind: rule.kind,
      entries: entries as QualityRuleGlossaryEntry[],
      enabled,
      mode: null,
    };
  }
  if (rule.kind === "text_preserve") {
    return {
      kind: rule.kind,
      entries: entries as QualityRuleTextPreserveEntry[],
      enabled: null,
      mode: enabled ? "custom" : "off",
    };
  }
  return {
    kind: rule.kind,
    entries: entries as QualityRuleTextReplacementEntry[],
    enabled,
    mode: null,
  };
}

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
export function resolve_project_prompt_storage(): ProjectPromptStorage {
  const prompt = TRANSLATION_PROMPT;
  return {
    database_type: prompt.database_type,
    enabled_meta_key: prompt.enabled_meta_key,
    revision_meta_key: prompt.revision_meta_key,
  };
}

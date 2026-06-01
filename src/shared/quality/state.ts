import type { PromptSlice, PromptsSnapshot, QualitySlice, QualitySnapshot } from "./snapshot";
import type { PromptKind } from "../../domain/prompt";
import type { QualityRuleKind } from "../../domain/quality";

type QualityStateRuleKind = QualityRuleKind;

type QualityStateTaskKind = PromptKind;

type ProofreadingLookupQuery = {
  keyword: string;
  is_regex: boolean;
};

// 保证页面编辑切片时不会改写 query 返回的原始规则数组。
/**
 * 承接当前模块的核心控制分支。
 */
function cloneEntries(entries: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return entries.map((entry) => ({ ...entry }));
}

// 质量规则 snapshot 的唯一浅克隆入口。
/**
 * 承接当前模块的核心控制分支。
 */
function cloneQualitySlice(slice: QualitySlice): QualitySlice {
  return {
    ...slice,
    entries: cloneEntries(slice.entries),
  };
}

// 让提示词切片替换逻辑和质量规则切片保持同一不可变语义。
/**
 * 承接当前模块的核心控制分支。
 */
function clonePromptSlice(slice: PromptSlice): PromptSlice {
  return {
    ...slice,
  };
}

/**
 * 按公开规则类型读取质量规则切片，并返回可安全编辑的克隆对象。
 */
export function getQualityRuleSlice(
  quality: QualitySnapshot,
  rule_type: QualityStateRuleKind,
): QualitySlice {
  if (rule_type === "glossary") {
    return cloneQualitySlice(quality.glossary);
  }
  if (rule_type === "pre_replacement") {
    return cloneQualitySlice(quality.pre_replacement);
  }
  if (rule_type === "post_replacement") {
    return cloneQualitySlice(quality.post_replacement);
  }
  return cloneQualitySlice(quality.text_preserve);
}

/**
 * 按任务类型读取提示词切片，并返回可安全编辑的克隆对象。
 */
export function getPromptSlice(
  prompts: PromptsSnapshot,
  task_type: QualityStateTaskKind,
): PromptSlice {
  return task_type === "translation"
    ? clonePromptSlice(prompts.translation)
    : clonePromptSlice(prompts.analysis);
}

/**
 * 替换单个质量规则切片，同时克隆其它切片以避免保留可变引用。
 */
export function replaceQualityRuleSlice(
  quality: QualitySnapshot,
  rule_type: QualityStateRuleKind,
  next_slice: QualitySlice,
): QualitySnapshot {
  const cloned_quality = {
    glossary: cloneQualitySlice(quality.glossary),
    pre_replacement: cloneQualitySlice(quality.pre_replacement),
    post_replacement: cloneQualitySlice(quality.post_replacement),
    text_preserve: cloneQualitySlice(quality.text_preserve),
  };

  if (rule_type === "glossary") {
    cloned_quality.glossary = cloneQualitySlice(next_slice);
    return cloned_quality;
  }
  if (rule_type === "pre_replacement") {
    cloned_quality.pre_replacement = cloneQualitySlice(next_slice);
    return cloned_quality;
  }
  if (rule_type === "post_replacement") {
    cloned_quality.post_replacement = cloneQualitySlice(next_slice);
    return cloned_quality;
  }

  cloned_quality.text_preserve = cloneQualitySlice(next_slice);
  return cloned_quality;
}

/**
 * 替换单个任务提示词切片，保持 PromptsSnapshot 的不可变更新形状。
 */
export function replacePromptSlice(
  prompts: PromptsSnapshot,
  task_type: QualityStateTaskKind,
  next_slice: PromptSlice,
): PromptsSnapshot {
  return {
    translation:
      task_type === "translation"
        ? clonePromptSlice(next_slice)
        : clonePromptSlice(prompts.translation),
    analysis:
      task_type === "analysis" ? clonePromptSlice(next_slice) : clonePromptSlice(prompts.analysis),
  };
}

/**
 * 质量规则页跳转校对查找时，文本保护规则始终按正则语义查询。
 */
export function buildProofreadingLookupQuery(args: {
  rule_type: QualityStateRuleKind;
  entry: Record<string, unknown>;
}): ProofreadingLookupQuery {
  const keyword = String(args.entry.src ?? "").trim();

  if (args.rule_type === "text_preserve") {
    return {
      keyword,
      is_regex: true,
    };
  }

  return {
    keyword,
    is_regex: Boolean(args.entry.regex),
  };
}

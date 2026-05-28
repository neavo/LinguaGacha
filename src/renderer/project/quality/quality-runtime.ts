import type {
  PromptRuntimeSlice,
  PromptsRuntimeState,
  QualityRuleRuntimeSlice,
  QualityRulesRuntimeState,
} from "@/project/quality/quality-runtime-state";
import type { PromptKind } from "@domain/prompt";
import type { QualityRuleKind } from "@domain/quality";

type QualityRuntimeRuleType = QualityRuleKind;

type QualityRuntimeTaskType = PromptKind;

type ProofreadingLookupQuery = {
  keyword: string;
  is_regex: boolean;
};

// cloneEntries 保证页面编辑切片时不会改写 query 返回的原始规则数组。
/**
 * 承接当前模块的核心控制分支。
 */
function cloneEntries(entries: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return entries.map((entry) => ({ ...entry }));
}

// cloneQualitySlice 是质量规则 runtime 的唯一浅克隆入口。
/**
 * 承接当前模块的核心控制分支。
 */
function cloneQualitySlice(slice: QualityRuleRuntimeSlice): QualityRuleRuntimeSlice {
  return {
    ...slice,
    entries: cloneEntries(slice.entries),
  };
}

// clonePromptSlice 让提示词切片替换逻辑和质量规则切片保持同一不可变语义。
/**
 * 承接当前模块的核心控制分支。
 */
function clonePromptSlice(slice: PromptRuntimeSlice): PromptRuntimeSlice {
  return {
    ...slice,
  };
}

/**
 * 按公开规则类型读取质量规则切片，并返回可安全编辑的克隆对象。
 */
export function getQualityRuleSlice(
  quality: QualityRulesRuntimeState,
  rule_type: QualityRuntimeRuleType,
): QualityRuleRuntimeSlice {
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
  prompts: PromptsRuntimeState,
  task_type: QualityRuntimeTaskType,
): PromptRuntimeSlice {
  return task_type === "translation"
    ? clonePromptSlice(prompts.translation)
    : clonePromptSlice(prompts.analysis);
}

/**
 * 替换单个质量规则切片，同时克隆其它切片以避免保留可变引用。
 */
export function replaceQualityRuleSlice(
  quality: QualityRulesRuntimeState,
  rule_type: QualityRuntimeRuleType,
  next_slice: QualityRuleRuntimeSlice,
): QualityRulesRuntimeState {
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
 * 替换单个任务提示词切片，保持 PromptsRuntimeState 的不可变更新形状。
 */
export function replacePromptSlice(
  prompts: PromptsRuntimeState,
  task_type: QualityRuntimeTaskType,
  next_slice: PromptRuntimeSlice,
): PromptsRuntimeState {
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
  rule_type: QualityRuntimeRuleType;
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

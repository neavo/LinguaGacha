import type {
  ProjectStorePromptSlice,
  ProjectStorePromptsState,
  ProjectStoreQualityRuleSlice,
  ProjectStoreQualityState,
  ProjectStoreState,
} from './project-store'

export type QualityRuntimeRuleType =
  | 'glossary'
  | 'pre_replacement'
  | 'post_replacement'
  | 'text_preserve'

export type QualityRuntimeTaskType = 'translation' | 'analysis'

type ProofreadingLookupQuery = {
  keyword: string
  is_regex: boolean
}

function cloneEntries(
  entries: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return entries.map((entry) => ({ ...entry }))
}

function cloneQualitySlice(slice: ProjectStoreQualityRuleSlice): ProjectStoreQualityRuleSlice {
  return {
    ...slice,
    entries: cloneEntries(slice.entries),
  }
}

function clonePromptSlice(slice: ProjectStorePromptSlice): ProjectStorePromptSlice {
  return {
    ...slice,
  }
}

export function getQualityRuleSlice(
  quality: ProjectStoreQualityState,
  rule_type: QualityRuntimeRuleType,
): ProjectStoreQualityRuleSlice {
  if (rule_type === 'glossary') {
    return cloneQualitySlice(quality.glossary)
  }
  if (rule_type === 'pre_replacement') {
    return cloneQualitySlice(quality.pre_replacement)
  }
  if (rule_type === 'post_replacement') {
    return cloneQualitySlice(quality.post_replacement)
  }
  return cloneQualitySlice(quality.text_preserve)
}

export function getPromptSlice(
  prompts: ProjectStorePromptsState,
  task_type: QualityRuntimeTaskType,
): ProjectStorePromptSlice {
  return task_type === 'translation'
    ? clonePromptSlice(prompts.translation)
    : clonePromptSlice(prompts.analysis)
}

export function replaceQualityRuleSlice(
  quality: ProjectStoreQualityState,
  rule_type: QualityRuntimeRuleType,
  next_slice: ProjectStoreQualityRuleSlice,
): ProjectStoreQualityState {
  const cloned_quality = {
    glossary: cloneQualitySlice(quality.glossary),
    pre_replacement: cloneQualitySlice(quality.pre_replacement),
    post_replacement: cloneQualitySlice(quality.post_replacement),
    text_preserve: cloneQualitySlice(quality.text_preserve),
  }

  if (rule_type === 'glossary') {
    cloned_quality.glossary = cloneQualitySlice(next_slice)
    return cloned_quality
  }
  if (rule_type === 'pre_replacement') {
    cloned_quality.pre_replacement = cloneQualitySlice(next_slice)
    return cloned_quality
  }
  if (rule_type === 'post_replacement') {
    cloned_quality.post_replacement = cloneQualitySlice(next_slice)
    return cloned_quality
  }

  cloned_quality.text_preserve = cloneQualitySlice(next_slice)
  return cloned_quality
}

export function replacePromptSlice(
  prompts: ProjectStorePromptsState,
  task_type: QualityRuntimeTaskType,
  next_slice: ProjectStorePromptSlice,
): ProjectStorePromptsState {
  return {
    translation: task_type === 'translation'
      ? clonePromptSlice(next_slice)
      : clonePromptSlice(prompts.translation),
    analysis: task_type === 'analysis'
      ? clonePromptSlice(next_slice)
      : clonePromptSlice(prompts.analysis),
  }
}

export function serializeQualityRuntimeSnapshot(
  state: ProjectStoreState,
): Record<string, unknown> {
  return {
    quality: {
      glossary: getQualityRuleSlice(state.quality, 'glossary'),
      pre_replacement: getQualityRuleSlice(state.quality, 'pre_replacement'),
      post_replacement: getQualityRuleSlice(state.quality, 'post_replacement'),
      text_preserve: getQualityRuleSlice(state.quality, 'text_preserve'),
    },
    prompts: {
      translation: getPromptSlice(state.prompts, 'translation'),
      analysis: getPromptSlice(state.prompts, 'analysis'),
    },
  }
}

export function buildProofreadingLookupQuery(args: {
  rule_type: QualityRuntimeRuleType
  entry: Record<string, unknown>
}): ProofreadingLookupQuery {
  const keyword = String(args.entry.src ?? '').trim()

  if (args.rule_type === 'text_preserve') {
    return {
      keyword,
      is_regex: true,
    }
  }

  return {
    keyword,
    is_regex: Boolean(args.entry.regex),
  }
}

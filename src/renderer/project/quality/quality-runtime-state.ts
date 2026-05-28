// QualityRuleRuntimeSlice 是 renderer 页面消费后端 query 的质量规则最小快照。
export type QualityRuleRuntimeSlice = {
  entries: Array<Record<string, unknown>>;
  enabled: boolean;
  mode: string;
  revision: number;
};

// QualityRulesRuntimeState 按公开规则类型固定四个切片，页面不再按物理目录名取值。
export type QualityRulesRuntimeState = {
  glossary: QualityRuleRuntimeSlice;
  pre_replacement: QualityRuleRuntimeSlice;
  post_replacement: QualityRuleRuntimeSlice;
  text_preserve: QualityRuleRuntimeSlice;
};

// PromptRuntimeSlice 是单个任务提示词在 renderer 运行态中的窄化快照。
export type PromptRuntimeSlice = {
  text: string;
  enabled: boolean;
  revision: number;
};

// PromptsRuntimeState 只区分翻译和分析任务提示词，和任务类型词表保持一致。
export type PromptsRuntimeState = {
  translation: PromptRuntimeSlice;
  analysis: PromptRuntimeSlice;
};

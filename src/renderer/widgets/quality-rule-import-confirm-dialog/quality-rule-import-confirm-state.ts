export type QualityRuleImportConfirmState = {
  open: boolean;
  duplicate_count: number;
  submitting: boolean;
};

// 三按钮导入确认框由多个页面复用，空态必须能安全表达“没有待确认计划”
export function create_empty_quality_rule_import_confirm_state(): QualityRuleImportConfirmState {
  return {
    open: false,
    duplicate_count: 0,
    submitting: false,
  };
}

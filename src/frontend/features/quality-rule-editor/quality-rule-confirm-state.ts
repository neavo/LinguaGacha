/** 规则页可触发的破坏性确认动作集合。 */
export type QualityRuleConfirmKind =
  | "delete-selection"
  | "delete-preset"
  | "reset"
  | "overwrite-preset";

/** 规则页确认弹窗的共享状态，open 与 kind 保持同步以便调用方窄化。 */
export type QualityRuleConfirmState =
  | {
      open: false;
      kind: null;
      selection_count: number;
      preset_name: string;
      preset_input_value: string;
      submitting: boolean;
      target_virtual_id: string | null;
    }
  | {
      open: true;
      kind: QualityRuleConfirmKind;
      selection_count: number;
      preset_name: string;
      preset_input_value: string;
      submitting: boolean;
      target_virtual_id: string | null;
    };

/** 三个规则页共用同一空确认快照，避免各页维护第二套字段集合。 */
export function create_empty_quality_rule_confirm_state(): QualityRuleConfirmState {
  return {
    open: false,
    kind: null,
    selection_count: 0,
    preset_name: "",
    preset_input_value: "",
    submitting: false,
    target_virtual_id: null,
  };
}

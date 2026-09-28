import { useCallback, useRef, useState } from "react";
import type { JsonRecord } from "@domain/json";
import {
  preview_quality_rule_import,
  quality_rule_entries_equal,
  type QualityRuleImportRuleType,
} from "@shared/quality/quality-rule-import";
/** 弹窗只消费确认结果；批量导入额外开放跳过。 */
export type QualityRuleDuplicateConfirmState = Readonly<{
  open: boolean;
  duplicate_count: number;
  submitting: boolean;
  allow_skip: boolean;
}>;
const EMPTY_CONFIRMATION: QualityRuleDuplicateConfirmState = {
  open: false,
  duplicate_count: 0,
  submitting: false,
  allow_skip: false,
};

export type QualityRuleDuplicateResolutionResult = "saved" | "pending" | "failed";
/** 编辑计划保留完整基线和无冲突时的插入位置；批量导入使用合并结果。 */
export type QualityRuleDuplicateResolutionPlan<E extends JsonRecord> = {
  kind: "edit" | "import";
  existing_entries: E[];
  incoming_entries: E[];
  baseline_entries?: E[];
  direct_entries?: E[];
  on_cancel?: () => void;
};
type Pending<E extends JsonRecord, Options> = {
  create_plan: () => QualityRuleDuplicateResolutionPlan<E>;
  options: Options;
  signature: string; // 用户确认时看到的目标身份与内容
  cancel: (() => void) | undefined;
};

/** 编辑和导入共用确认；确认期间按最新事实重算，项目失效后丢弃异步收尾。 */
export function useQualityRuleDuplicateConfirmation<E extends JsonRecord, Options>(args: {
  rule_type: QualityRuleImportRuleType;
  apply_entries: (entries: E[], options: Options) => Promise<boolean>;
}) {
  const { rule_type, apply_entries } = args;
  const [state, set_state] = useState<QualityRuleDuplicateConfirmState>(EMPTY_CONFIRMATION);
  const [pending, set_pending] = useState<Pending<E, Options> | null>(null);
  const generation = useRef(0); // 重置后拒绝旧提交更新弹窗。
  const submitting = useRef(false); // 同步阻止连续点击发起两次覆盖。
  /** 结束当前确认并使在途提交的界面收尾失效。 */
  const reset_import_confirmation = useCallback(() => {
    generation.current += 1;
    submitting.current = false;
    set_pending(null);
    set_state(EMPTY_CONFIRMATION);
  }, []);
  /** 按规则执行身份生成当前重复预览。 */
  function preview(plan: QualityRuleDuplicateResolutionPlan<E>) {
    return preview_quality_rule_import({
      rule_type,
      existing: plan.existing_entries,
      incoming: plan.incoming_entries,
    });
  }
  /** 根据操作来源开放批量跳过入口。 */
  function show(plan: QualityRuleDuplicateResolutionPlan<E>, count: number): void {
    set_state({
      open: true,
      duplicate_count: count,
      submitting: false,
      allow_skip: plan.kind === "import",
    });
  }
  /** 生成当前计划，存在实际覆盖时等待用户决定。 */
  async function persist_entries_with_duplicate_resolution(
    create_plan: () => QualityRuleDuplicateResolutionPlan<E>,
    options: Options,
  ): Promise<QualityRuleDuplicateResolutionResult> {
    const plan = create_plan();
    const result = preview(plan);
    const entries =
      result.duplicate_count === 0 && plan.direct_entries
        ? plan.direct_entries
        : result.overwrite_entries;
    if (
      result.duplicate_count > 0 &&
      !quality_rule_entries_equal(
        rule_type,
        entries,
        plan.baseline_entries ?? plan.existing_entries,
      )
    ) {
      set_pending({
        create_plan,
        options,
        signature: signature(result, plan),
        cancel: plan.on_cancel,
      });
      show(plan, result.duplicate_count);
      return "pending";
    }
    return (await apply_entries(entries as E[], options)) ? "saved" : "failed";
  }
  /** 空闲时取消确认，并交回待编辑草稿。 */
  function close_import_duplicate_confirm(): void {
    if (submitting.current) return;
    pending?.cancel?.();
    reset_import_confirmation();
  }
  /** 确认时重算目标；目标变化先更新预览，再等待新的确认。 */
  async function apply(action: "skip" | "overwrite"): Promise<void> {
    if (pending === null || submitting.current) return;
    const plan = pending.create_plan();
    const result = preview(plan);
    const next_signature = signature(result, plan);
    if (result.duplicate_count > 0 && next_signature !== pending.signature) {
      set_pending({ ...pending, signature: next_signature });
      show(plan, result.duplicate_count);
      return;
    }
    const token = generation.current;
    submitting.current = true;
    set_state({ ...state, submitting: true });
    const entries =
      result.duplicate_count === 0 && plan.direct_entries
        ? plan.direct_entries
        : action === "skip"
          ? result.skip_entries
          : result.overwrite_entries;
    const saved = await apply_entries(entries as E[], pending.options);
    if (token !== generation.current) return;
    submitting.current = false;
    if (saved) reset_import_confirmation();
    else set_state({ ...state, submitting: false });
  }
  return {
    import_confirm_state: state,
    persist_entries_with_duplicate_resolution,
    import_duplicate_skip: () => apply("skip"),
    import_duplicate_overwrite: () => apply("overwrite"),
    close_import_duplicate_confirm,
    reset_import_confirmation,
  };
}

/** 目标身份及覆盖内容变化都需要重新确认；无关条目的变化不影响本次决定。 */
function signature(
  result: ReturnType<typeof preview_quality_rule_import>,
  plan: QualityRuleDuplicateResolutionPlan<JsonRecord>,
): string {
  return JSON.stringify(
    result.duplicates.map((duplicate) => ({
      incoming: plan.incoming_entries[duplicate.incoming_index],
      existing: duplicate.existing_indexes.map((index) => plan.existing_entries[index]),
    })),
  );
}

import { useCallback, useState } from "react";

import {
  create_empty_quality_rule_import_confirm_state,
  type QualityRuleImportConfirmState,
} from "@frontend/widgets/quality-rule-import-confirm-dialog/quality-rule-import-confirm-state";
import type { JsonRecord } from "@shared/utils/json-tool";
import {
  preview_quality_rule_import,
  type QualityRuleImportAction,
  type QualityRuleImportRuleType,
} from "@shared/quality/importer";

// 导入完成后页面菜单交互的通用控制项。
export type QualityRuleImportApplyOptions = {
  close_preset_menu: boolean;
};

// 一次导入尝试的最终可观察结果。
export type QualityRuleDuplicateResolutionResult = "saved" | "pending" | "failed";

// 保存重复项导入在 skip / overwrite 两种路径下的候选写入结果。
export type QualityRuleDuplicateResolutionPlan<TEntry extends JsonRecord> = {
  existing_entries: TEntry[];
  incoming_entries: TEntry[];
  direct_entries?: TEntry[];
  skip_entries?: TEntry[] | null;
  overwrite_entries?: TEntry[];
  before_pending?: () => void;
  before_apply?: () => void;
};

type QualityRuleDuplicateResolutionPlanFactory<TEntry extends JsonRecord> =
  () => QualityRuleDuplicateResolutionPlan<TEntry>;

type PendingQualityRuleImport<TEntry extends JsonRecord, TApplyOptions> = {
  create_plan: QualityRuleDuplicateResolutionPlanFactory<TEntry>;
  options: TApplyOptions;
  duplicate_signature: string;
};

type UseQualityRuleImportConfirmationOptions<TEntry extends JsonRecord, TApplyOptions> = {
  rule_type: QualityRuleImportRuleType;
  apply_entries: (next_entries: TEntry[], options: TApplyOptions) => Promise<boolean>;
};

type UseQualityRuleImportConfirmationResult<TEntry extends JsonRecord, TApplyOptions> = {
  import_confirm_state: QualityRuleImportConfirmState;
  persist_entries_with_duplicate_resolution: (
    create_plan: QualityRuleDuplicateResolutionPlanFactory<TEntry>,
    options: TApplyOptions,
  ) => Promise<QualityRuleDuplicateResolutionResult>;
  import_duplicate_skip: () => Promise<void>;
  import_duplicate_overwrite: () => Promise<void>;
  close_import_duplicate_confirm: () => void;
  reset_import_confirmation: () => void;
};

/**
 * 质量规则导入确认 hook 统一处理重复预览、用户选择和确认期间事实变化。
 */
export function useQualityRuleImportConfirmation<
  TEntry extends JsonRecord,
  TApplyOptions = QualityRuleImportApplyOptions,
>(
  options: UseQualityRuleImportConfirmationOptions<TEntry, TApplyOptions>,
): UseQualityRuleImportConfirmationResult<TEntry, TApplyOptions> {
  const { rule_type, apply_entries } = options;
  const [import_confirm_state, set_import_confirm_state] = useState<QualityRuleImportConfirmState>(
    () => {
      return create_empty_quality_rule_import_confirm_state();
    },
  );
  // 待确认状态只保存计划工厂；最终写入快照必须在用户确认时用最新 query 事实重算
  const [pending_import, set_pending_import] = useState<PendingQualityRuleImport<
    TEntry,
    TApplyOptions
  > | null>(null);

  const build_preview = useCallback(
    (plan: QualityRuleDuplicateResolutionPlan<TEntry>) => {
      return preview_quality_rule_import({
        rule_type,
        existing: plan.existing_entries,
        incoming: plan.incoming_entries,
      });
    },
    [rule_type],
  );

  const persist_entries_with_duplicate_resolution = useCallback(
    async (
      create_plan: QualityRuleDuplicateResolutionPlanFactory<TEntry>,
      apply_options: TApplyOptions,
    ): Promise<QualityRuleDuplicateResolutionResult> => {
      const plan = create_plan();
      const preview = build_preview(plan);
      if (preview.duplicate_count > 0) {
        set_pending_import({
          create_plan,
          options: apply_options,
          duplicate_signature: build_duplicate_signature(preview),
        });
        set_import_confirm_state({
          open: true,
          duplicate_count: preview.duplicate_count,
          submitting: false,
        });
        plan.before_pending?.();
        return "pending";
      }

      plan.before_apply?.();
      const next_entries = plan.direct_entries ?? preview.overwrite_entries;
      const saved = await apply_entries(next_entries as TEntry[], apply_options);
      return saved ? "saved" : "failed";
    },
    [apply_entries, build_preview],
  );

  const close_import_duplicate_confirm = useCallback((): void => {
    if (import_confirm_state.submitting) {
      return;
    }
    set_pending_import(null);
    set_import_confirm_state(create_empty_quality_rule_import_confirm_state());
  }, [import_confirm_state.submitting]);

  const reset_import_confirmation = useCallback((): void => {
    set_pending_import(null);
    set_import_confirm_state(create_empty_quality_rule_import_confirm_state());
  }, []);

  const apply_pending_import_action = useCallback(
    async (action: QualityRuleImportAction): Promise<void> => {
      if (pending_import === null) {
        return;
      }

      set_import_confirm_state((previous_state) => {
        return {
          ...previous_state,
          submitting: true,
        };
      });

      const plan = pending_import.create_plan();
      const preview = build_preview(plan);
      const duplicate_signature = build_duplicate_signature(preview);
      // 用户确认期间项目事实可能变化，需要用签名阻止旧预览继续提交。
      if (
        preview.duplicate_count > 0 &&
        duplicate_signature !== pending_import.duplicate_signature
      ) {
        set_pending_import({
          ...pending_import,
          duplicate_signature,
        });
        set_import_confirm_state({
          open: true,
          duplicate_count: preview.duplicate_count,
          submitting: false,
        });
        return;
      }

      const planned_entries = action === "skip" ? plan.skip_entries : plan.overwrite_entries;
      if (planned_entries === null) {
        set_pending_import(null);
        set_import_confirm_state(create_empty_quality_rule_import_confirm_state());
        return;
      }

      const next_entries =
        planned_entries ?? (action === "skip" ? preview.skip_entries : preview.overwrite_entries);
      plan.before_apply?.();
      const saved = await apply_entries(next_entries as TEntry[], pending_import.options);
      if (saved) {
        set_pending_import(null);
        set_import_confirm_state(create_empty_quality_rule_import_confirm_state());
        return;
      }

      set_import_confirm_state((previous_state) => {
        return {
          ...previous_state,
          submitting: false,
        };
      });
    },
    [apply_entries, build_preview, pending_import],
  );

  const import_duplicate_skip = useCallback(async (): Promise<void> => {
    await apply_pending_import_action("skip");
  }, [apply_pending_import_action]);

  const import_duplicate_overwrite = useCallback(async (): Promise<void> => {
    await apply_pending_import_action("overwrite");
  }, [apply_pending_import_action]);

  return {
    import_confirm_state,
    persist_entries_with_duplicate_resolution,
    import_duplicate_skip,
    import_duplicate_overwrite,
    close_import_duplicate_confirm,
    reset_import_confirmation,
  };
}

/**
 * 创建重复项导入计划时克隆所有条目数组，避免确认弹窗持有页面可变草稿引用。
 */
export function create_quality_rule_duplicate_resolution_plan<TEntry extends JsonRecord>(args: {
  existing_entries: TEntry[];
  incoming_entries: TEntry[];
  direct_entries?: TEntry[];
  skip_entries?: TEntry[] | null;
  overwrite_entries?: TEntry[];
  before_pending?: () => void;
  before_apply?: () => void;
}): QualityRuleDuplicateResolutionPlan<TEntry> {
  return {
    existing_entries: clone_entries(args.existing_entries),
    incoming_entries: clone_entries(args.incoming_entries),
    direct_entries:
      args.direct_entries === undefined ? undefined : clone_entries(args.direct_entries),
    skip_entries:
      args.skip_entries === undefined || args.skip_entries === null
        ? args.skip_entries
        : clone_entries(args.skip_entries),
    overwrite_entries:
      args.overwrite_entries === undefined ? undefined : clone_entries(args.overwrite_entries),
    before_pending: args.before_pending,
    before_apply: args.before_apply,
  };
}

/**
 * 规则条目是 JSON 记录，浅克隆即可切断数组和顶层字段引用。
 */
function clone_entries<TEntry extends JsonRecord>(entries: TEntry[] | undefined): TEntry[] {
  return (entries ?? []).map((entry) => ({ ...entry }) as TEntry);
}

/**
 * 重复签名只描述重复集合身份；确认时签名变化意味着必须重新展示冲突数量。
 */
function build_duplicate_signature(
  preview: ReturnType<typeof preview_quality_rule_import>,
): string {
  return preview.duplicates
    .map((duplicate) => {
      return [
        duplicate.incoming_index,
        duplicate.key,
        duplicate.kind,
        duplicate.existing_indexes.join(","),
      ].join(":");
    })
    .join("|");
}

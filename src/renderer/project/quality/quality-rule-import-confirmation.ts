import { useCallback, useState } from "react";

import {
  create_empty_quality_rule_import_confirm_state,
  type QualityRuleImportConfirmState,
} from "@/widgets/quality-rule-import-confirm-dialog/quality-rule-import-confirm-state";
import type { JsonRecord } from "@shared/utils/json-tool";
import {
  preview_quality_rule_import,
  type QualityRuleImportAction,
  type QualityRuleImportRuleType,
} from "@shared/quality/importer";

export type QualityRuleImportApplyOptions = {
  close_preset_menu: boolean;
};

type PendingQualityRuleImport<TEntry extends JsonRecord> = {
  incoming_entries: TEntry[];
  options: QualityRuleImportApplyOptions;
  duplicate_signature: string;
};

type UseQualityRuleImportConfirmationOptions<TEntry extends JsonRecord> = {
  rule_type: QualityRuleImportRuleType;
  get_existing_entries: () => TEntry[];
  apply_entries: (
    next_entries: TEntry[],
    options: QualityRuleImportApplyOptions,
  ) => Promise<boolean>;
};

type UseQualityRuleImportConfirmationResult<TEntry extends JsonRecord> = {
  import_confirm_state: QualityRuleImportConfirmState;
  persist_import_entries: (
    incoming_entries: TEntry[],
    options: QualityRuleImportApplyOptions,
  ) => Promise<boolean>;
  import_duplicate_skip: () => Promise<void>;
  import_duplicate_overwrite: () => Promise<void>;
  close_import_duplicate_confirm: () => void;
  reset_import_confirmation: () => void;
};

export function useQualityRuleImportConfirmation<TEntry extends JsonRecord>(
  options: UseQualityRuleImportConfirmationOptions<TEntry>,
): UseQualityRuleImportConfirmationResult<TEntry> {
  const { rule_type, get_existing_entries, apply_entries } = options;
  const [import_confirm_state, set_import_confirm_state] = useState<QualityRuleImportConfirmState>(
    () => {
      return create_empty_quality_rule_import_confirm_state();
    },
  );
  // 待确认状态只保存导入输入；最终写入快照必须在用户确认时用最新 ProjectStore 事实重算
  const [pending_import, set_pending_import] = useState<PendingQualityRuleImport<TEntry> | null>(
    null,
  );

  const build_preview = useCallback(
    (incoming_entries: TEntry[]) => {
      return preview_quality_rule_import({
        rule_type,
        existing: get_existing_entries(),
        incoming: incoming_entries,
      });
    },
    [get_existing_entries, rule_type],
  );

  const persist_import_entries = useCallback(
    async (
      incoming_entries: TEntry[],
      apply_options: QualityRuleImportApplyOptions,
    ): Promise<boolean> => {
      const preview = build_preview(incoming_entries);
      if (preview.duplicate_count > 0) {
        set_pending_import({
          incoming_entries: clone_entries(incoming_entries),
          options: apply_options,
          duplicate_signature: build_duplicate_signature(preview),
        });
        set_import_confirm_state({
          open: true,
          duplicate_count: preview.duplicate_count,
          submitting: false,
        });
        return false;
      }

      return apply_entries(preview.overwrite_entries as TEntry[], apply_options);
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

      const preview = build_preview(pending_import.incoming_entries);
      const duplicate_signature = build_duplicate_signature(preview);
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

      const next_entries = action === "skip" ? preview.skip_entries : preview.overwrite_entries;
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
    persist_import_entries,
    import_duplicate_skip,
    import_duplicate_overwrite,
    close_import_duplicate_confirm,
    reset_import_confirmation,
  };
}

function clone_entries<TEntry extends JsonRecord>(entries: TEntry[]): TEntry[] {
  return entries.map((entry) => ({ ...entry }) as TEntry);
}

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

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { QualityRuleUpdateRequest } from "@shared/quality/quality-rule-api";
import type { QualityRuleEntryByKind, QualityRuleKind } from "@domain/quality";
import { create_quality_rule_entry_id } from "@shared/quality/quality-rule-entry";
import {
  QualityRuleImportRuleTypeValue,
  quality_rule_entries_equal,
} from "@shared/quality/quality-rule-import";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import type { ProjectSessionTableUiStateController } from "@frontend/app/session/project-session-ui-state-context";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import {
  PRESERVE_RESULT_REFRESH,
  REBUILD_RESULT_REFRESH,
  type PendingResultRefresh,
  type ResultRefreshPolicy,
} from "@frontend/app/result/snapshot";
import { create_project_section_result_refresh } from "@frontend/app/result/refresh";
import {
  update_quality_rule,
  import_quality_rule_entries,
  read_quality_rule_preset,
  pick_quality_rule_import_path,
  export_quality_rule_entries,
} from "./quality-rule-api-client";
import {
  useQualityRuleDuplicateConfirmation,
  type QualityRuleDuplicateResolutionPlan,
} from "./use-quality-rule-duplicate-confirmation";
import {
  create_empty_quality_rule_confirm_state,
  type QualityRuleConfirmState,
} from "./quality-rule-confirm-state";
import {
  order_quality_rule_entries_by_id,
  resolve_quality_rule_insert_after_entry_id,
} from "./quality-rule-selection";

export type QualityRuleDraft<E> = Omit<E, "entry_id"> & { entry_id?: string };
export type QualityRuleDialogState<E> = {
  open: boolean;
  mode: "create" | "edit";
  target_entry_id: string | null;
  insert_after_entry_id: string | null;
  draft_entry: QualityRuleDraft<E>;
  saving: boolean;
  invalid: boolean;
};
const IMPORT_KIND = {
  glossary: QualityRuleImportRuleTypeValue.GLOSSARY,
  pre_replacement: QualityRuleImportRuleTypeValue.PRE_REPLACEMENT,
  post_replacement: QualityRuleImportRuleTypeValue.POST_REPLACEMENT,
  text_preserve: QualityRuleImportRuleTypeValue.TEXT_PRESERVE,
} as const;
type ApplyOptions = { source: "import" | "preset" | "dialog"; refresh: ResultRefreshPolicy };

/** 页面编辑只持有草稿和意图，项目事实、事务恢复和结果版本门闩继续使用现有拥有者。 */
export function useQualityRuleEditing<K extends QualityRuleKind>(options: {
  rule_type: K;
  project_path: string;
  entries: QualityRuleEntryByKind[K][];
  section_revision: number;
  readonly: boolean;
  reorder_disabled: boolean;
  empty_entry: QualityRuleDraft<QualityRuleEntryByKind[K]>;
  normalize: <E extends QualityRuleDraft<QualityRuleEntryByKind[K]>>(entry: E) => E;
  validate: (entry: QualityRuleDraft<QualityRuleEntryByKind[K]>) => string | null;
  selection: Pick<
    ProjectSessionTableUiStateController<unknown, unknown>,
    | "selected_row_ids"
    | "active_row_id"
    | "anchor_row_id"
    | "set_selection_state"
    | "restore_selection_state"
    | "clear_selection_state"
  >;
  refresh: () => Promise<unknown>;
  set_result_refresh: (value: PendingResultRefresh | null) => void;
  close_preset_menu: () => void;
  export_file_name: string;
}) {
  type Entry = QualityRuleEntryByKind[K];
  const { t } = useI18n();
  const { commit_project_write } = useDesktopState();
  const current = useRef(options); // 确认操作读取最近一次已提交的 React 快照及其修订。
  const generation = useRef(0); // 项目切换及卸载使异步操作的界面收尾失效。
  const busy = useRef(false); // 同一次页面编辑只允许一个工程提交，防止双击形成并发快照写入。
  /** 为一次编辑建立独立草稿和空操作状态。 */
  const empty_dialog = (): QualityRuleDialogState<Entry> => ({
    open: false,
    mode: "create",
    target_entry_id: null,
    insert_after_entry_id: null,
    draft_entry: { ...options.empty_entry },
    saving: false,
    invalid: false,
  });
  const [dialog_state, set_dialog_state] = useState<QualityRuleDialogState<Entry>>(empty_dialog);
  const [confirm_state, set_confirm_state] = useState<QualityRuleConfirmState>(
    create_empty_quality_rule_confirm_state,
  );
  const pending_delete = useRef<string[]>([]); // 删除确认绑定受理时的条目身份。
  useLayoutEffect(() => {
    current.current = options;
  });

  /** 把当前操作错误映射为一条用户反馈。 */
  const report = useCallback(
    (error: unknown, key: LocaleKey) => {
      push_toast("error", resolve_visible_error_message(error, t, t(key)));
    },
    [t],
  );

  /** 使用候选数据对应的修订提交，成功后刷新权威规则。 */
  const save_entries_snapshot = useCallback(
    async (
      next_entries: Entry[],
      policy: ResultRefreshPolicy = PRESERVE_RESULT_REFRESH,
    ): Promise<boolean> => {
      const state = current.current;
      if (state.readonly || busy.current) return false;
      const normalized_entries = next_entries.map(state.normalize);
      if (
        quality_rule_entries_equal(IMPORT_KIND[state.rule_type], normalized_entries, state.entries)
      )
        return true;
      const token = generation.current;
      busy.current = true;
      try {
        await commit_project_write({
          operation: `${state.rule_type}.entries_save`,
          run: () =>
            update_quality_rule({
              rule_type: state.rule_type,
              expected_section_revisions: { quality: state.section_revision },
              entries: normalized_entries,
            }),
          prepare: ({ write_result }) => {
            if (token === generation.current)
              state.set_result_refresh(
                create_project_section_result_refresh({ write_result, policy, section: "quality" }),
              );
          },
        });
        if (token !== generation.current) return false;
        await state.refresh();
        return token === generation.current;
      } catch (error) {
        if (token === generation.current) {
          state.set_result_refresh(null);
          report(error, "quality_rule_editor.feedback.save_failed");
        }
        return false;
      } finally {
        if (token === generation.current) busy.current = false;
      }
    },
    [commit_project_write, report],
  );

  /** 元信息和条目共用同一快照版本及提交互斥；模式切换的等待反馈由页面拥有。 */
  const update_meta = useCallback(
    async (meta: NonNullable<QualityRuleUpdateRequest<K>["meta"]>): Promise<void> => {
      const state = current.current;
      if (state.readonly || busy.current) return;
      const token = generation.current;
      busy.current = true;
      try {
        await commit_project_write({
          operation: `${state.rule_type}.${meta.mode === undefined ? "meta_update" : "mode_update"}`,
          run: () =>
            update_quality_rule({
              rule_type: state.rule_type,
              expected_section_revisions: { quality: state.section_revision },
              meta,
            }),
        });
        if (token === generation.current) await state.refresh();
      } finally {
        if (token === generation.current) busy.current = false;
      }
    },
    [commit_project_write],
  );
  /** 按页面规则类型提交元信息并反馈失败。 */
  const update_meta_with_feedback = useCallback(
    async (meta: NonNullable<QualityRuleUpdateRequest<K>["meta"]>): Promise<void> => {
      try {
        await update_meta(meta);
      } catch (error) {
        report(error, "quality_rule_editor.feedback.update_failed");
      }
    },
    [report, update_meta],
  );

  /** 提交已裁决条目，再结束对应的编辑或导入交互。 */
  const apply_entries = useCallback(
    async (entries: Entry[], action: ApplyOptions): Promise<boolean> => {
      const saved = await save_entries_snapshot(entries, action.refresh);
      if (!saved) return false;
      if (action.source === "dialog")
        set_dialog_state((state) => ({ ...state, open: false, saving: false }));
      else current.current.selection.clear_selection_state();
      if (action.source === "import") push_toast("success", t("app.feedback.import_success"));
      if (action.source === "preset") current.current.close_preset_menu();
      return true;
    },
    [save_entries_snapshot, t],
  );
  const duplicates = useQualityRuleDuplicateConfirmation<Entry, ApplyOptions>({
    rule_type: IMPORT_KIND[options.rule_type],
    apply_entries,
  });
  const { reset_import_confirmation } = duplicates;
  useLayoutEffect(() => {
    generation.current += 1;
    busy.current = false;
    set_dialog_state((state) => ({ ...state, open: false, saving: false }));
    set_confirm_state(create_empty_quality_rule_confirm_state());
    reset_import_confirmation();
    return () => {
      generation.current += 1;
    };
  }, [options.project_path, options.rule_type, reset_import_confirmation]);

  /** 记录新增位置并准备独立草稿。 */
  function open_create_dialog(): void {
    if (options.readonly || busy.current) return;
    const ids = new Map(options.entries.map((entry, index) => [entry.entry_id, index]));
    const insert_after_entry_id = resolve_quality_rule_insert_after_entry_id(
      options.selection.active_row_id,
      options.selection.selected_row_ids,
      ids,
    );
    options.selection.clear_selection_state();
    set_dialog_state({ ...empty_dialog(), open: true, insert_after_entry_id });
  }
  /** 按稳定身份选中目标并复制编辑草稿。 */
  function open_edit_dialog(id: string): void {
    const entry = options.entries.find((item) => item.entry_id === id);
    if (!entry || busy.current) return;
    options.selection.set_selection_state({
      selected_row_ids: [id],
      active_row_id: id,
      anchor_row_id: id,
    });
    set_dialog_state({
      ...empty_dialog(),
      open: true,
      mode: "edit",
      target_entry_id: id,
      draft_entry: { ...entry },
    });
  }
  /** 更新草稿；已有校验错误随输入重新判断。 */
  function update_dialog_draft(patch: Partial<QualityRuleDraft<Entry>>): void {
    set_dialog_state((state) => {
      const draft_entry = { ...state.draft_entry, ...patch };
      return {
        ...state,
        draft_entry,
        invalid: state.invalid && options.validate(options.normalize(draft_entry)) !== null,
      };
    });
  }
  /** 校验草稿，术语和保护规则经覆盖确认后提交。 */
  async function save_dialog_entry(): Promise<void> {
    if (options.readonly || busy.current) return;
    const draft = options.normalize(dialog_state.draft_entry);
    const error = options.validate(draft);
    if (error !== null) {
      set_dialog_state({ ...dialog_state, invalid: true });
      push_toast("error", error);
      return;
    }
    const entry = {
      ...draft,
      entry_id:
        draft.entry_id ??
        create_quality_rule_entry_id(new Set(options.entries.map((item) => item.entry_id))),
    } as Entry;
    const editing = dialog_state;
    const token = generation.current;
    /** 只向原项目恢复待编辑草稿。 */
    const restore = () => {
      if (token === generation.current) set_dialog_state({ ...editing, open: true, saving: false });
    };
    /** 在当前规则快照上重算插入或编辑，编辑判重排除自身。 */
    const create_plan = (): QualityRuleDuplicateResolutionPlan<Entry> => {
      const entries = current.current.entries;
      const next_entries = [...entries];
      if (editing.mode === "edit") {
        const index = next_entries.findIndex((item) => item.entry_id === editing.target_entry_id);
        if (index >= 0) next_entries[index] = entry;
      } else {
        const index = next_entries.findIndex(
          (item) => item.entry_id === editing.insert_after_entry_id,
        );
        next_entries.splice(index < 0 ? entries.length : index + 1, 0, entry);
      }
      return {
        existing_entries: entries.filter((item) => item.entry_id !== editing.target_entry_id),
        incoming_entries: [entry],
        direct_entries: next_entries,
        baseline_entries: entries,
        kind: "edit",
        on_cancel: restore,
      };
    };
    const action: ApplyOptions = {
      source: "dialog",
      refresh: editing.mode === "create" ? REBUILD_RESULT_REFRESH : PRESERVE_RESULT_REFRESH,
    };
    // 草稿在确认与提交期间继续由编辑流程持有；隐藏弹窗不清空草稿。
    set_dialog_state({ ...editing, open: false, saving: true });
    if (options.rule_type === "glossary" || options.rule_type === "text_preserve") {
      const result = await duplicates.persist_entries_with_duplicate_resolution(
        create_plan,
        action,
      );
      if (result === "failed") restore();
    } else if (!(await apply_entries(create_plan().direct_entries!, action))) restore();
  }

  /** 读取文件或预设条目，按当前项目规则处理重复。 */
  async function import_entries(
    source: "import" | "preset",
    read: () => Promise<Entry[]>,
  ): Promise<void> {
    if (options.readonly || busy.current) return;
    const token = generation.current;
    try {
      const incoming_entries = await read();
      if (token !== generation.current) return;
      if (incoming_entries.length === 0) {
        push_toast("warning", t("app.feedback.no_valid_data"));
        return;
      }
      await duplicates.persist_entries_with_duplicate_resolution(
        (): QualityRuleDuplicateResolutionPlan<Entry> => ({
          kind: "import",
          existing_entries: current.current.entries,
          incoming_entries,
        }),
        { source, refresh: REBUILD_RESULT_REFRESH },
      );
    } catch (error) {
      if (token === generation.current)
        report(
          error,
          source === "preset"
            ? "preset_editor.feedback.load_failed"
            : "quality_rule_editor.feedback.import_failed",
        );
    }
  }
  /** 把有效文件路径交给共享导入流程。 */
  async function import_entries_from_path(path: string): Promise<void> {
    if (path.trim() !== "")
      await import_entries("import", () => import_quality_rule_entries(options.rule_type, path));
  }
  /** 文件选择完成后核对项目身份，再开始导入。 */
  async function import_entries_from_picker(): Promise<void> {
    if (options.readonly) return;
    const token = generation.current;
    try {
      const path = await pick_quality_rule_import_path();
      if (path !== null && token === generation.current) await import_entries_from_path(path);
    } catch (error) {
      if (token === generation.current) report(error, "quality_rule_editor.feedback.import_failed");
    }
  }
  /** 导出当前快照，用户完成选择后反馈结果。 */
  async function export_entries_from_picker(): Promise<void> {
    try {
      if (
        await export_quality_rule_entries({
          rule_type: options.rule_type,
          entries: options.entries.map(options.normalize),
          file_name: options.export_file_name,
        })
      )
        push_toast("success", t("app.feedback.export_success"));
    } catch (error) {
      report(error, "quality_rule_editor.feedback.export_failed");
    }
  }
  /** 冻结本次待删除身份，供确认后提交。 */
  async function delete_selected_entries(): Promise<void> {
    if (options.readonly || options.selection.selected_row_ids.length === 0) return;
    pending_delete.current = [...options.selection.selected_row_ids];
    set_confirm_state({
      ...create_empty_quality_rule_confirm_state(),
      open: true,
      kind: "delete-selection",
      selection_count: pending_delete.current.length,
    });
  }
  /** 记录清空规则意图，等待用户确认。 */
  function request_reset_entries(): void {
    if (!options.readonly)
      set_confirm_state({
        ...create_empty_quality_rule_confirm_state(),
        open: true,
        kind: "reset",
      });
  }
  /** 执行当前确认，失败时恢复可操作状态。 */
  async function confirm_pending_action(): Promise<void> {
    if (options.readonly || !confirm_state.open || busy.current) return;
    const token = generation.current;
    set_confirm_state({ ...confirm_state, submitting: true });
    const ids = new Set(pending_delete.current);
    const reset = confirm_state.kind === "reset";
    const selection = options.selection;
    options.selection.clear_selection_state();
    const saved = await save_entries_snapshot(
      reset ? [] : options.entries.filter((entry) => !ids.has(entry.entry_id)),
      reset ? REBUILD_RESULT_REFRESH : PRESERVE_RESULT_REFRESH,
    );
    if (token !== generation.current) return;
    if (saved) {
      set_confirm_state(create_empty_quality_rule_confirm_state());
      if (reset) options.close_preset_menu();
    } else {
      options.selection.restore_selection_state(selection);
      set_confirm_state({ ...confirm_state, submitting: false });
    }
  }
  /** 按表格裁决的完整身份顺序保存规则。 */
  async function reorder_entries(ids: string[]): Promise<void> {
    if (!options.reorder_disabled)
      await save_entries_snapshot(
        order_quality_rule_entries_by_id(options.entries, ids),
        REBUILD_RESULT_REFRESH,
      );
  }
  return {
    dialog_state,
    confirm_state,
    open_create_dialog,
    open_edit_dialog,
    update_dialog_draft,
    save_dialog_entry,
    // 关闭编辑释放当前草稿。
    request_close_dialog: async () => {
      set_dialog_state(empty_dialog());
    },
    save_entries_snapshot,
    update_meta,
    update_meta_with_feedback,
    delete_selected_entries,
    request_reset_entries,
    confirm_pending_action,
    close_confirm_dialog: () => set_confirm_state(create_empty_quality_rule_confirm_state()),
    reorder_entries,
    import_entries_from_path,
    import_entries_from_picker,
    export_entries_from_picker,
    apply_preset: (id: string) =>
      import_entries("preset", () => read_quality_rule_preset(options.rule_type, id)),
    import_confirm_state: duplicates.import_confirm_state,
    import_duplicate_skip: duplicates.import_duplicate_skip,
    import_duplicate_overwrite: duplicates.import_duplicate_overwrite,
    close_import_duplicate_confirm: duplicates.close_import_duplicate_confirm,
  };
}

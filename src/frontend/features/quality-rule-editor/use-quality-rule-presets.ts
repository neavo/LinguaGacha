import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { QualityRule } from "@domain/quality";
import type { QualityRulePresets } from "@shared/quality/quality-rule-api";
import type { QualityRuleKind, QualityRuleEntryByKind } from "@domain/quality";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";

import {
  create_empty_preset_input_state,
  decorate_preset_items,
  normalize_preset_name,
  build_user_preset_virtual_id,
  has_casefold_duplicate_preset,
} from "@frontend/features/preset-editor/preset-model";
import type { PresetItem, PresetInputState } from "@frontend/features/preset-editor/preset-types";
import {
  create_empty_quality_rule_confirm_state,
  type QualityRuleConfirmState,
} from "./quality-rule-confirm-state";
import {
  read_quality_rule_presets,
  save_quality_rule_preset,
  rename_quality_rule_preset,
  delete_quality_rule_preset,
  update_quality_rule_default_preset,
} from "./quality-rule-api-client";

/** 预设状态只驻页面；默认项由应用设置投影，文件与默认引用的变更由后端命令完成。 */
export function useQualityRulePresets<K extends QualityRuleKind>(
  rule_type: K,
  entries: QualityRuleEntryByKind[K][],
  ready: boolean,
) {
  const { t } = useI18n();
  const { settings_snapshot, apply_settings_snapshot, project_snapshot, refresh_settings } =
    useDesktopState();
  const [preset_snapshot, set_preset_snapshot] = useState<QualityRulePresets>({
    builtin_presets: [],
    user_presets: [],
  });
  const preset_items = useMemo(
    () =>
      decorate_preset_items(
        preset_snapshot.builtin_presets,
        preset_snapshot.user_presets,
        String(
          settings_snapshot[QualityRule.from_json(rule_type).default_preset_setting_key] ?? "",
        ),
      ),
    [preset_snapshot, rule_type, settings_snapshot],
  );
  const [preset_menu_open, set_preset_menu_open] = useState(false);
  const [preset_input_state, set_preset_input_state] = useState<PresetInputState>(
    create_empty_preset_input_state,
  );
  const [confirm_state, set_confirm_state] = useState<QualityRuleConfirmState>(
    create_empty_quality_rule_confirm_state,
  );

  const generation = useRef(0); // 项目或规则页切换使旧操作的界面收尾失效。
  const busy = useRef(false); // 文件操作受理到收尾期间禁止重复提交。
  useLayoutEffect(() => {
    generation.current += 1;
    busy.current = false;
    set_preset_menu_open(false);
    set_preset_input_state(create_empty_preset_input_state());
    set_confirm_state(create_empty_quality_rule_confirm_state());
    set_preset_snapshot({ builtin_presets: [], user_presets: [] });
    return () => {
      generation.current += 1;
    };
  }, [project_snapshot.path, rule_type]);

  /** 把当前操作错误映射为一条用户反馈。 */
  function report(error: unknown, key: LocaleKey): void {
    push_error_toast(t(key), error);
  }
  /** 已提交错误不能重试原文件操作；重读两端事实后结束原命令。 */
  async function handle_command_error(error: unknown, key: LocaleKey): Promise<boolean> {
    if (!(error instanceof DesktopApiError) || error.code !== "data.committed_sync_failed") {
      report(error, key);
      return false;
    }
    let failure = error as unknown;
    try {
      await Promise.all([refresh_preset_menu(), refresh_settings()]);
    } catch (cause) {
      failure = new AggregateError([error, cause], "Failed to reload committed preset state.");
    }
    report(failure, "app.feedback.load_failed");
    return true;
  }
  /** 重读预设列表，旧页面的回包随页面失效。 */
  async function refresh_preset_menu(): Promise<void> {
    const token = generation.current;
    const snapshot = await read_quality_rule_presets(rule_type);
    if (token === generation.current) set_preset_snapshot(snapshot);
  }
  /** 取得最新列表后打开预设菜单。 */
  async function open_preset_menu(): Promise<void> {
    const token = generation.current;
    try {
      await refresh_preset_menu();
      if (token === generation.current) set_preset_menu_open(true);
    } catch (error) {
      if (token === generation.current) {
        set_preset_menu_open(false);
        report(error, "app.feedback.load_failed");
      }
    }
  }
  /** 打开当前规则的预设命名流程。 */
  function request_save_preset(): void {
    if (!ready) return;
    set_preset_input_state({
      open: true,
      mode: "save",
      value: "",
      submitting: false,
      target_virtual_id: null,
    });
  }
  /** 记录预设身份及当前名称。 */
  function request_rename_preset(item: PresetItem): void {
    set_preset_input_state({
      open: true,
      mode: "rename",
      value: item.name,
      submitting: false,
      target_virtual_id: item.virtual_id,
    });
  }
  /** 记录待删除预设，等待用户确认。 */
  function request_delete_preset(item: PresetItem): void {
    set_confirm_state({
      ...create_empty_quality_rule_confirm_state(),
      open: true,
      kind: "delete-preset",
      preset_name: item.name,
      target_virtual_id: item.virtual_id,
    });
  }
  /** 保存预设并读取目录结果。 */
  async function save_preset(name: string): Promise<boolean> {
    if (!ready) return false;
    const token = generation.current;
    let error_key: LocaleKey = "app.feedback.save_failed";
    try {
      await save_quality_rule_preset(rule_type, name, entries);
      if (token !== generation.current) return false;
      error_key = "app.feedback.load_failed";
      await refresh_preset_menu();
      return token === generation.current;
    } catch (error) {
      if (token === generation.current) report(error, error_key);
      return false;
    }
  }
  /** 消费后端一次提交后的名称和默认设置快照。 */
  async function rename_preset(id: string, name: string): Promise<boolean> {
    const token = generation.current;
    try {
      const result = await rename_quality_rule_preset(rule_type, id, name);
      if (token !== generation.current) return false;
      apply_settings_snapshot(result);
      set_preset_snapshot(result);
      return true;
    } catch (error) {
      return (
        token === generation.current &&
        (await handle_command_error(error, "app.feedback.rename_failed"))
      );
    }
  }
  /** 保存规则槽位的默认引用并应用设置回包。 */
  async function set_default_preset(virtual_id: string): Promise<void> {
    try {
      apply_settings_snapshot(
        await update_quality_rule_default_preset(
          QualityRule.from_json(rule_type).default_preset_setting_key,
          virtual_id,
        ),
      );
    } catch (error) {
      report(error, "app.feedback.save_failed");
    }
  }
  /** 结束命名并释放本次输入。 */
  function close_preset_input_dialog(): void {
    set_preset_input_state(create_empty_preset_input_state());
  }
  /** 更新名称输入，保留当前操作目标。 */
  function update_preset_input_value(value: string): void {
    set_preset_input_state((state) => ({ ...state, value }));
  }
  /** 校验名称及重名关系，再执行保存或重命名。 */
  async function submit_preset_input(): Promise<void> {
    if (!preset_input_state.open || busy.current) return;
    const name = normalize_preset_name(preset_input_state.value);
    if (name === "") {
      push_toast("warning", t("preset_editor.feedback.name_required"));
      return;
    }
    const duplicate = has_casefold_duplicate_preset(
      preset_items,
      build_user_preset_virtual_id(name),
      preset_input_state.target_virtual_id,
    );
    if (duplicate) {
      if (preset_input_state.mode === "rename")
        push_toast("warning", t("preset_editor.feedback.exists"));
      else
        set_confirm_state({
          ...create_empty_quality_rule_confirm_state(),
          open: true,
          kind: "overwrite-preset",
          preset_name: name,
          preset_input_value: name,
        });
      return;
    }
    const token = generation.current;
    busy.current = true;
    set_preset_input_state({ ...preset_input_state, submitting: true });
    const succeeded =
      preset_input_state.mode === "save"
        ? await save_preset(name)
        : preset_input_state.target_virtual_id !== null &&
          (await rename_preset(preset_input_state.target_virtual_id, name));
    if (token !== generation.current) return;
    busy.current = false;
    if (succeeded) close_preset_input_dialog();
    else set_preset_input_state({ ...preset_input_state, submitting: false });
  }
  /** 执行当前确认，失败时恢复可操作状态。 */
  async function confirm_pending_action(): Promise<void> {
    if (!confirm_state.open || busy.current) return;
    const token = generation.current;
    busy.current = true;
    set_confirm_state({ ...confirm_state, submitting: true });
    let succeeded = false;
    try {
      if (confirm_state.kind === "delete-preset" && confirm_state.target_virtual_id !== null) {
        const result = await delete_quality_rule_preset(rule_type, confirm_state.target_virtual_id);
        if (token !== generation.current) return;
        apply_settings_snapshot(result);
        set_preset_snapshot(result);
        succeeded = true;
      } else if (confirm_state.kind === "overwrite-preset") {
        succeeded = await save_preset(confirm_state.preset_input_value);
        if (succeeded) close_preset_input_dialog();
      }
    } catch (error) {
      if (token === generation.current)
        succeeded = await handle_command_error(error, "app.feedback.delete_failed");
    }
    if (token !== generation.current) return;
    busy.current = false;
    set_confirm_state(
      succeeded
        ? create_empty_quality_rule_confirm_state()
        : { ...confirm_state, submitting: false },
    );
  }
  return {
    preset_items,
    preset_menu_open,
    set_preset_menu_open,
    preset_input_state,
    confirm_state,
    open_preset_menu,
    request_save_preset,
    request_rename_preset,
    request_delete_preset,
    set_default_preset,
    cancel_default_preset: () => set_default_preset(""),
    update_preset_input_value,
    submit_preset_input,
    close_preset_input_dialog,
    confirm_pending_action,
    close_confirm_dialog: () => set_confirm_state(create_empty_quality_rule_confirm_state()),
  };
}

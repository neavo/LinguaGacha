import { GodotPackOrderDialog } from "@frontend/features/godot-pack-order/godot-pack-order-dialog";
import { useEffect, useState, type JSX } from "react";
import { AppActionDialog, AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { useTranslationExport } from "@frontend/app/session/translation-export/translation-export-context";
import { useProjectTranslationStats } from "@frontend/app/session/project-translation-stats-context";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useBatchTaskSession } from "@frontend/app/session/batch-task/batch-task-session-context";
import { useWorkbenchPageState } from "@frontend/pages/workbench-page/use-workbench-page-state";
import { WorkbenchCommandBar } from "@frontend/pages/workbench-page/components/workbench-command-bar";
import { WorkbenchDialogs } from "@frontend/pages/workbench-page/components/workbench-dialogs";
import { WorkbenchFileTable } from "@frontend/pages/workbench-page/components/workbench-file-table";
import { WorkbenchStatsSection } from "@frontend/pages/workbench-page/components/workbench-stats-section";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { format_agent_reference } from "@shared/agent-reference";
import { FileDropZone } from "@frontend/widgets/file-drop-zone/file-drop-zone";
import "@frontend/pages/workbench-page/workbench-page.css";

/** 工作台持有启动选择，翻译执行与 AGENT 草稿交给现有会话入口。 */
export function WorkbenchPage(): JSX.Element {
  const { t } = useI18n();
  const { navigate_to_agent } = useAppNavigation();
  const { batch_task } = useBatchTaskSession();
  const translation_export = useTranslationExport();
  const workbench_state = useWorkbenchPageState();
  const translation_stats = useProjectTranslationStats();
  const [start_dialog_open, set_start_dialog_open] = useState(false); // 启动选择随页面卸载结束。
  // PDF 按页处理，图片和通用数据需要专属写回，由 AGENT 完成流程。
  const requires_agent = workbench_state.entries.some(
    (entry) =>
      entry.file_type === "PDF" || entry.file_type === "GENERIC" || entry.file_type === "IMAGE",
  );
  // 文件快照就绪后才决定入口。PDF 即使没有文本条目也能转交。
  const can_start_translation =
    workbench_state.cache_status === "ready" &&
    !workbench_state.readonly &&
    !batch_task.translation_task_menu_disabled &&
    (requires_agent || workbench_state.entries.some((entry) => entry.progress.total_count > 0));

  // 文件刷新、运行占用或工程切换后结束旧选择，避免沿用过期的文件判断。
  useEffect(() => {
    set_start_dialog_open(false);
  }, [can_start_translation, workbench_state.settled_project_path]);

  const agent_action = {
    label: t("app.action.handle_with_agent"),
    onSelect: () => {
      set_start_dialog_open(false);
      // 复用首页任务建议，导航只预填草稿，由用户发送。
      navigate_to_agent({
        text: `${t("agent_page.empty.suggestions.translate_full_text")} ${format_agent_reference({ kind: "skill", name: "translation" })}`,
      });
    },
  };

  return (
    <div className="workbench-page page-shell page-shell--full">
      <WorkbenchStatsSection stats={translation_stats} />
      <FileDropZone
        label={t("app.drop.import_here")}
        disabled={!workbench_state.can_edit_files}
        on_paths_drop={(paths) => {
          void workbench_state.request_add_files_from_paths(paths);
        }}
        on_drop_issue={workbench_state.notify_add_file_drop_issue}
      >
        <WorkbenchFileTable
          entries={workbench_state.entries}
          selected_entry_ids={workbench_state.selected_entry_ids}
          active_entry_id={workbench_state.active_entry_id}
          anchor_entry_id={workbench_state.anchor_entry_id}
          readonly={workbench_state.readonly}
          on_selection_change={workbench_state.apply_table_selection}
          on_rename={workbench_state.request_rename_file}
          on_reset={workbench_state.request_reset_file}
          on_reorder={workbench_state.request_reorder_entries}
        />
      </FileDropZone>
      <WorkbenchCommandBar
        can_start_translation={can_start_translation}
        on_request_start_translation={() => set_start_dialog_open(true)}
        batch_task={batch_task}
        translation_stats={translation_stats}
        can_edit_files={workbench_state.can_edit_files}
        can_delete_selected_files={workbench_state.can_delete_selected_files}
        can_export_translation={translation_export.can_request_export}
        can_close_project={workbench_state.can_close_project}
        on_add_file={() => {
          void workbench_state.request_add_file();
        }}
        on_delete_selected={workbench_state.request_delete_selected_files}
        on_export_translation={translation_export.request_export}
        on_close_project={workbench_state.request_close_project}
      />
      {start_dialog_open && can_start_translation ? (
        <AppActionDialog
          open
          description={t(
            requires_agent
              ? "workbench_page.dialog.start_translation.agent_required"
              : "workbench_page.dialog.start_translation.agent_recommended",
          )}
          primaryAction={
            requires_agent
              ? agent_action
              : {
                  label: t("workbench_page.dialog.start_translation.translate_directly"),
                  onSelect: () => {
                    set_start_dialog_open(false);
                    void batch_task.request_start_or_continue_translation();
                  },
                }
          }
          secondaryAction={requires_agent ? undefined : agent_action}
          onClose={() => set_start_dialog_open(false)}
        />
      ) : null}
      <GodotPackOrderDialog {...workbench_state.godot_pack_order.dialog_props} />
      <AppConfirmDialog {...workbench_state.game_backup_confirm.dialog_props} />
      <WorkbenchDialogs
        dialog_state={workbench_state.dialog_state}
        entries={workbench_state.entries}
        on_confirm={() => {
          void workbench_state.confirm_dialog();
        }}
        on_rename={(new_rel_path) => {
          void workbench_state.confirm_rename_file(new_rel_path);
        }}
        on_secondary={() => {
          void workbench_state.secondary_dialog();
        }}
        on_close={workbench_state.close_dialog}
      />
    </div>
  );
}

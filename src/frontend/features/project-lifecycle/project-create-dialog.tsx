import type { JSX } from "react";
import { File, FilePlus, FolderOpen, Lightbulb } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import {
  AppContextMenu,
  AppContextMenuContent,
  AppContextMenuItem,
  AppContextMenuTrigger,
} from "@frontend/widgets/app-context-menu";
import { open_context_menu_at_click_position } from "@frontend/widgets/app-menu";
import { PathSelectionCard } from "@frontend/widgets/path-selection-card/path-selection-card";
import { GodotPackOrderDialog } from "@frontend/features/godot-pack-order/godot-pack-order-dialog";
import { ProjectSourceFormats } from "./project-source-formats";
import { ProjectLanguageDialog } from "@frontend/features/project-language/project-language-dialog";
import type { useProjectCreateFlow } from "./use-project-create-flow";
import "./project-lifecycle.css";
/** 来源选择与后续确认保持父子关系，子弹窗关闭后恢复创建焦点。 */
export function ProjectCreateDialog(props: {
  flow: ReturnType<typeof useProjectCreateFlow>;
}): JSX.Element {
  const { t } = useI18n();
  const { flow } = props;

  return (
    <AppPageDialog
      open={flow.open}
      title={t("project.create.title")}
      size="lg"
      onClose={flow.close}
      submitting={flow.source_selection_disabled}
      bodyClassName="project-lifecycle gap-[18px]"
      primaryAction={{
        label: t("project.create.action"),
        shortcut: "submit",
        onSelect: flow.open_language_dialog,
      }}
    >
      <AppContextMenu disabled={flow.source_selection_disabled}>
        <AppContextMenuTrigger
          render={
            <PathSelectionCard
              icon={FilePlus}
              title={t("project.create.drop_title")}
              summary={
                flow.selected_source === null
                  ? null
                  : {
                      name: t("project.create.ready_status", {
                        COUNT: flow.selected_source.source_file_count.toString(),
                      }),
                    }
              }
              clear_label={t("app.action.reset")}
              on_clear={flow.clear_selected_source}
              disabled={flow.source_selection_disabled}
              onClick={open_context_menu_at_click_position}
              on_paths_drop={flow.handle_select_source_paths}
              on_drop_issue={flow.handle_drop_issue}
            />
          }
        />
        <AppContextMenuContent>
          <AppContextMenuItem
            disabled={flow.source_selection_disabled}
            onClick={() => {
              void flow.handle_select_source_file();
            }}
          >
            <File className="size-4" />
            {t("app.action.select_file")}
          </AppContextMenuItem>
          <AppContextMenuItem
            disabled={flow.source_selection_disabled}
            onClick={() => {
              void flow.handle_select_source_folder();
            }}
          >
            <FolderOpen className="size-4" />
            {t("app.action.select_folder")}
          </AppContextMenuItem>
        </AppContextMenuContent>
      </AppContextMenu>
      <ProjectSourceFormats format_hit_counts={flow.selected_source?.format_hit_counts} />
      <p className="project-lifecycle__notice">
        <Lightbulb aria-hidden="true" />
        <span className="project-lifecycle__notice-text">
          <span>{t("project.formats.any_format_notice")}</span>
          <span>
            {t("project.formats.empty_project_hint", { ACTION: t("project.create.action") })}
          </span>
        </span>
      </p>
      <GodotPackOrderDialog {...flow.pack_order.dialog_props} />
      <AppConfirmDialog {...flow.backup_confirm.dialog_props} />
      <ProjectLanguageDialog
        open={flow.is_language_dialog_open}
        languages={flow.create_languages}
        on_change={(field, value) =>
          flow.set_create_languages((previous) => ({ ...previous, [field]: value }))
        }
        on_confirm={flow.confirm_language_dialog}
        on_close={() => flow.set_is_language_dialog_open(false)}
      />
    </AppPageDialog>
  );
}

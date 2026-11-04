import type { JSX } from "react";
import { File, FilePlus, FolderOpen } from "lucide-react";
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
import { ProjectLanguageDialog } from "./project-language-dialog";
import type { useProjectCreateFlow } from "./use-project-create-flow";
import "./project-lifecycle.css";
/** 创建与后续确认保持父子关系，子弹窗关闭后恢复创建焦点。 */
export function ProjectCreateDialog(props: {
  flow: ReturnType<typeof useProjectCreateFlow>;
}): JSX.Element {
  const { t } = useI18n();
  const {
    selected_source,
    source_selection_disabled,
    clear_selected_source,
    handle_select_source_paths,
    handle_drop_issue,
    handle_select_source_file,
    handle_select_source_folder,
  } = props.flow;
  const flow = props.flow;
  const source_selection = (
    <AppContextMenu disabled={source_selection_disabled}>
      <AppContextMenuTrigger
        render={
          <PathSelectionCard
            className="project-lifecycle__selection--source"
            icon={FilePlus}
            title={t("project.create.drop_title")}
            summary={
              selected_source === null
                ? null
                : {
                    name: t("project.create.ready_status", {
                      COUNT: selected_source.source_file_count.toString(),
                    }),
                  }
            }
            clear_label={t("app.action.reset")}
            on_clear={clear_selected_source}
            disabled={source_selection_disabled}
            onClick={open_context_menu_at_click_position}
            on_paths_drop={handle_select_source_paths}
            on_drop_issue={handle_drop_issue}
          />
        }
      />
      <AppContextMenuContent>
        <AppContextMenuItem
          disabled={source_selection_disabled}
          onClick={() => {
            void handle_select_source_file();
          }}
        >
          <File className="size-4" />
          {t("app.action.select_file")}
        </AppContextMenuItem>
        <AppContextMenuItem
          disabled={source_selection_disabled}
          onClick={() => {
            void handle_select_source_folder();
          }}
        >
          <FolderOpen className="size-4" />
          {t("app.action.select_folder")}
        </AppContextMenuItem>
      </AppContextMenuContent>
    </AppContextMenu>
  );

  return (
    <AppPageDialog
      open={flow.open}
      title={t("project.create.title")}
      size="lg"
      onClose={flow.close}
      submitting={source_selection_disabled}
      bodyClassName="project-lifecycle gap-[18px]"
      primaryAction={{
        label: t("project.create.action"),
        shortcut: "submit",
        onSelect: flow.open_language_dialog,
      }}
    >
      <p className="text-muted-foreground">{t("project.create.subtitle")}</p>
      {source_selection}
      <ProjectSourceFormats format_hit_counts={selected_source?.format_hit_counts} />
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

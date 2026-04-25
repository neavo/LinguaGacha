import {
  Check,
  GraduationCap,
  ListTodo,
  Plus,
  Recycle,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

import { useI18n } from "@/i18n";
import "@/pages/model-page/model-page.css";
import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";
import { ModelCategoryCard } from "@/pages/model-page/components/model-category-card";
import { ModelItemChip } from "@/pages/model-page/components/model-item-chip";
import { ModelAdvancedSettingsDialog } from "@/pages/model-page/dialogs/model-advanced-settings-dialog";
import { ModelBasicSettingsDialog } from "@/pages/model-page/dialogs/model-basic-settings-dialog";
import { ModelSelectorDialog } from "@/pages/model-page/dialogs/model-selector-dialog";
import { ModelTaskSettingsDialog } from "@/pages/model-page/dialogs/model-task-settings-dialog";
import { useModelPageState } from "@/pages/model-page/use-model-page-state";
import { Button } from "@/shadcn/button";
import {
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
} from "@/widgets/app-dropdown-menu/app-dropdown-menu";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type ModelPageProps = {
  is_sidebar_collapsed: boolean;
};

export function ModelPage(props: ModelPageProps): JSX.Element {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const model_page_state = useModelPageState();
  const selector_model =
    model_page_state.snapshot.models.find(
      (model) => model.id === model_page_state.selector_state.model_id,
    ) ?? null;

  return (
    <>
      <AppAlertDialog
        open={model_page_state.confirm_state.kind !== null}
        description={
          model_page_state.confirm_state.kind === "delete"
            ? t("model_page.confirm.delete.description")
            : model_page_state.confirm_state.kind === "reset"
              ? t("model_page.confirm.reset.description")
              : ""
        }
        onConfirm={model_page_state.confirm_dialog}
        onClose={model_page_state.close_confirm}
      />

      <ModelBasicSettingsDialog
        open={model_page_state.dialog_state.kind === "basic"}
        model={model_page_state.active_dialog_model}
        readonly={model_page_state.readonly}
        onPatch={(patch) =>
          model_page_state.update_model_patch(model_page_state.dialog_state.model_id ?? "", patch)
        }
        onRequestOpenSelector={() => {
          if (model_page_state.dialog_state.model_id !== null) {
            model_page_state.open_selector_dialog(model_page_state.dialog_state.model_id);
          }
        }}
        onRequestTestModel={() =>
          model_page_state.request_test_model(model_page_state.dialog_state.model_id ?? "")
        }
        onClose={model_page_state.close_dialog}
      />

      <ModelTaskSettingsDialog
        open={model_page_state.dialog_state.kind === "task"}
        model={model_page_state.active_dialog_model}
        readonly={model_page_state.readonly}
        onPatch={(patch) =>
          model_page_state.update_model_patch(model_page_state.dialog_state.model_id ?? "", patch)
        }
        onClose={model_page_state.close_dialog}
      />

      <ModelAdvancedSettingsDialog
        open={model_page_state.dialog_state.kind === "advanced"}
        model={model_page_state.active_dialog_model}
        readonly={model_page_state.readonly}
        onPatch={(patch) =>
          model_page_state.update_model_patch(model_page_state.dialog_state.model_id ?? "", patch)
        }
        onJsonFormatError={() => {
          push_toast("warning", t("model_page.feedback.json_format_error"));
        }}
        onClose={model_page_state.close_dialog}
      />

      <ModelSelectorDialog
        open={model_page_state.selector_state.open}
        model={selector_model}
        available_models={model_page_state.selector_state.available_models}
        filter_text={model_page_state.selector_state.filter_text}
        is_loading={model_page_state.selector_state.is_loading}
        onFilterTextChange={model_page_state.set_selector_filter_text}
        onLoadAvailableModels={model_page_state.load_available_models}
        onSelectModelId={model_page_state.select_model_id}
        onClose={model_page_state.close_selector_dialog}
      />

      <div
        className="model-page page-shell page-shell--full"
        data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
      >
        <section className="model-page__list" aria-label={t("model_page.title")}>
          {model_page_state.grouped_categories.map((category) => (
            <ModelCategoryCard
              key={category.type}
              title={category.title}
              description={category.description}
              accent_color={category.accent_color}
              models={category.models}
              drag_disabled={model_page_state.readonly}
              add_action={
                category.can_add ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void model_page_state.request_add_model(category.type);
                    }}
                  >
                    <Plus data-icon="inline-start" />
                    {t("model_page.action.add")}
                  </Button>
                ) : null
              }
              on_reorder={(ordered_model_ids) => {
                void model_page_state.request_reorder_models(category.type, ordered_model_ids);
              }}
            >
              {category.models.map((model) => (
                <ModelItemChip
                  key={model.id}
                  model={model}
                  active={model.id === model_page_state.snapshot.active_model_id}
                  drag_disabled={model_page_state.readonly}
                  drag_aria_label={t("workbench_page.table.drag_handle_aria")}
                  menu={
                    <AppDropdownMenuContent align="center">
                      <AppDropdownMenuGroup>
                        <AppDropdownMenuItem
                          onSelect={() => {
                            void model_page_state.request_activate_model(model.id);
                          }}
                        >
                          <Check />
                          {t("model_page.action.activate")}
                        </AppDropdownMenuItem>
                        <AppDropdownMenuSeparator />
                        <AppDropdownMenuItem
                          onSelect={() => {
                            model_page_state.open_dialog("basic", model.id);
                          }}
                        >
                          <SlidersHorizontal />
                          {t("model_page.action.basic_settings")}
                        </AppDropdownMenuItem>
                        <AppDropdownMenuItem
                          onSelect={() => {
                            model_page_state.open_dialog("task", model.id);
                          }}
                        >
                          <ListTodo />
                          {t("model_page.action.task_settings")}
                        </AppDropdownMenuItem>
                        <AppDropdownMenuItem
                          onSelect={() => {
                            model_page_state.open_dialog("advanced", model.id);
                          }}
                        >
                          <GraduationCap />
                          {t("model_page.action.advanced_settings")}
                        </AppDropdownMenuItem>
                        <AppDropdownMenuSeparator />
                        {model.type === "PRESET" ? (
                          <AppDropdownMenuItem
                            onSelect={() => {
                              model_page_state.request_reset_model(model.id);
                            }}
                          >
                            <Recycle />
                            {t("model_page.action.reset")}
                          </AppDropdownMenuItem>
                        ) : (
                          <AppDropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              model_page_state.request_delete_model(model.id);
                            }}
                          >
                            <Trash2 />
                            {t("model_page.action.delete")}
                          </AppDropdownMenuItem>
                        )}
                      </AppDropdownMenuGroup>
                    </AppDropdownMenuContent>
                  }
                />
              ))}
            </ModelCategoryCard>
          ))}
        </section>
      </div>
    </>
  );
}

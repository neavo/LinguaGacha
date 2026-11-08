import { useState, type JSX } from "react";
import { ChevronDown, Circle, CircleCheck } from "lucide-react";
import type { AgentFunctionUsage } from "@domain/model";
import type { ModelSelectionInput } from "@shared/model-selection";
import { useI18n } from "@frontend/app/locale/locale-context";
import { ModelSelectionOptions } from "@frontend/features/model-selection/model-selection-menu";
import { MODEL_THINKING_LEVEL_LABEL_KEY } from "@frontend/features/model-selection/model-selection-meta";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import { AppButton } from "@frontend/widgets/app-button";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { SettingsList } from "@frontend/widgets/settings-list/settings-list";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuTrigger,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
} from "@frontend/widgets/app-dropdown-menu";

/** 选择值由页面控制器拥有，弹窗只管理菜单；主控确认仍由会话处理。 */
export function AgentFunctionModelsDialog(props: {
  open: boolean;
  on_close: () => void;
  locked: boolean;
  controller: ModelSelectionController;
  on_agent_model_select: (change: ModelSelectionInput) => boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <AppPageDialog
      open={props.open}
      onClose={props.on_close}
      title={t("agent_page.function_models.title")}
      size="lg"
      bodyClassName="overflow-hidden p-0"
    >
      <SettingsList>
        <SettingCardRow
          variant="group"
          action_width="content"
          title={t("agent_page.function_models.agent")}
          description={t("agent_page.function_models.agent_description")}
          action={
            <FunctionModelMenu
              controller={props.controller}
              target="agent"
              disabled={props.locked}
              on_select={(change) => {
                if (props.on_agent_model_select(change)) props.on_close();
              }}
            />
          }
        />
        <SettingCardRow
          variant="group"
          action_width="content"
          title={t("agent_page.function_models.translation")}
          description={t("agent_page.function_models.translation_description")}
          action={
            <FunctionModelMenu
              controller={props.controller}
              target="agent_batch_translation"
              disabled={props.locked}
              on_select={(change) => {
                void props.controller.select_model({
                  target: "agent_batch_translation",
                  ...change,
                });
              }}
            />
          }
        />
        <SettingCardRow
          variant="group"
          action_width="content"
          title={t("agent_page.function_models.media")}
          description={t("agent_page.function_models.media_description")}
          action={
            <FunctionModelMenu
              controller={props.controller}
              target="agent_media"
              disabled={props.locked}
              on_select={(change) => {
                void props.controller.select_model({ target: "agent_media", ...change });
              }}
            />
          }
        />
      </SettingsList>
    </AppPageDialog>
  );
}

/** 复用模型与等级菜单。跟随项只提交用途选择。 */
function FunctionModelMenu(props: {
  controller: ModelSelectionController;
  target: "agent" | AgentFunctionUsage;
  disabled: boolean;
  on_select: (change: ModelSelectionInput) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [open, set_open] = useState(false);
  const disabled = props.disabled || props.controller.loading || props.controller.updating;
  if (disabled && open) set_open(false);
  const id = props.controller.snapshot.model_selection[props.target];
  const model = props.controller.snapshot.models.find((item) => item.id === id);
  const name =
    id === null
      ? t("agent_page.function_models.follow")
      : model?.name || model?.id || t("app.model.selection.unavailable");
  const FollowIcon = id === null ? CircleCheck : Circle;
  return (
    <AppDropdownMenu open={open} onOpenChange={set_open}>
      <AppDropdownMenuTrigger
        render={
          <AppButton
            variant="outline"
            size="sm"
            disabled={disabled}
            className="agent-function-models__select border-input bg-popover text-foreground dark:bg-popover"
          >
            <span className="agent-function-models__name">{name}</span>
            {model === undefined ? null : (
              <span>· {t(MODEL_THINKING_LEVEL_LABEL_KEY[model.thinking_level])}</span>
            )}
            <ChevronDown aria-hidden="true" />
          </AppButton>
        }
      />
      <AppDropdownMenuContent align="end" matchTriggerWidth={false}>
        {props.target === "agent" ? null : (
          <>
            <AppDropdownMenuItem
              aria-current={id === null ? "true" : undefined}
              disabled={disabled}
              onClick={() => {
                if (props.target !== "agent")
                  void props.controller.select_model({ target: props.target, model_id: null });
              }}
            >
              <FollowIcon aria-hidden="true" />
              {t("agent_page.function_models.follow")}
            </AppDropdownMenuItem>
            <AppDropdownMenuSeparator />
          </>
        )}
        <ModelSelectionOptions
          models={props.controller.snapshot.models}
          value={id ?? ""}
          disabled={disabled}
          on_select={props.on_select}
        />
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}

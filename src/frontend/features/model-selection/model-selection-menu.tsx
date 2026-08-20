import { Circle, CircleCheck, Cpu } from "lucide-react";

import { MODEL_TYPES, is_model_thinking_level, type ModelUsage } from "@domain/model";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  AppDropdownMenuRadioGroup,
  AppDropdownMenuRadioItem,
  AppDropdownMenuSub,
  AppDropdownMenuSubContent,
  AppDropdownMenuSubTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { read_selected_model, type ModelSelectionController } from "./use-model-selection";
import { MODEL_THINKING_LEVEL_LABEL_KEY, MODEL_TYPE_TITLE_KEY } from "./model-selection-meta";

type ModelSelectionMenuProps = {
  controller: ModelSelectionController;
  usage: ModelUsage;
  disabled?: boolean;
};

/** 工作台使用的三级入口：当前模型、模型类型、类型内模型。 */
export function ModelSelectionMenu(props: ModelSelectionMenuProps): JSX.Element {
  const { t } = useI18n();
  const selected = read_selected_model(props.controller, props.usage);
  const selected_name = selected?.name || selected?.id || t("app.model.selection.unavailable");
  const disabled = Boolean(props.disabled) || props.controller.loading || props.controller.updating;

  return (
    <AppDropdownMenuSub>
      <AppDropdownMenuSubTrigger disabled={disabled} title={selected_name}>
        <Cpu aria-hidden="true" />
        <span className="max-w-72 truncate">{selected_name}</span>
      </AppDropdownMenuSubTrigger>
      <AppDropdownMenuSubContent>
        <ModelSelectionCategories {...props} />
      </AppDropdownMenuSubContent>
    </AppDropdownMenuSub>
  );
}

/** Agent 底栏按钮已承担当前模型入口，因此只复用分类与模型两层。 */
export function ModelSelectionCategories(props: ModelSelectionMenuProps): JSX.Element {
  const { t } = useI18n();
  const selected_id = props.controller.snapshot.model_selection[props.usage];
  const selected = props.controller.snapshot.models.find((model) => model.id === selected_id);
  const disabled = Boolean(props.disabled) || props.controller.loading || props.controller.updating;

  return (
    <>
      {MODEL_TYPES.map((model_type) => {
        const models = props.controller.snapshot.models.filter(
          (model) => model.type === model_type,
        );
        const current_category = selected?.type === model_type;
        const CategoryIcon = current_category ? CircleCheck : Circle;
        return (
          <AppDropdownMenuSub key={model_type}>
            <AppDropdownMenuSubTrigger
              disabled={disabled || models.length === 0}
              aria-current={current_category ? "true" : undefined}
            >
              <CategoryIcon aria-hidden="true" />
              <span>{t(MODEL_TYPE_TITLE_KEY[model_type])}</span>
            </AppDropdownMenuSubTrigger>
            <AppDropdownMenuSubContent>
              <AppDropdownMenuRadioGroup
                value={selected_id}
                onValueChange={(model_id) => {
                  void props.controller.select_model(props.usage, model_id);
                }}
              >
                {models.map((model) => (
                  <AppDropdownMenuRadioItem key={model.id} value={model.id} disabled={disabled}>
                    <span className="max-w-72 truncate">{model.name || model.id}</span>
                  </AppDropdownMenuRadioItem>
                ))}
              </AppDropdownMenuRadioGroup>
            </AppDropdownMenuSubContent>
          </AppDropdownMenuSub>
        );
      })}
    </>
  );
}

/** 当前用途模型的思考档位；触发器布局由消费页面负责。 */
export function ModelThinkingLevelOptions(props: ModelSelectionMenuProps): JSX.Element | null {
  const { t } = useI18n();
  const selected = read_selected_model(props.controller, props.usage);
  if (selected === null || selected.available_thinking_levels.length === 0) return null;
  const disabled = Boolean(props.disabled) || props.controller.loading || props.controller.updating;

  return (
    <AppDropdownMenuRadioGroup
      value={selected.thinking_level}
      onValueChange={(thinking_level) => {
        if (is_model_thinking_level(thinking_level)) {
          void props.controller.update_thinking_level(props.usage, thinking_level);
        }
      }}
    >
      {selected.available_thinking_levels.map((thinking_level) => (
        <AppDropdownMenuRadioItem key={thinking_level} value={thinking_level} disabled={disabled}>
          {t(MODEL_THINKING_LEVEL_LABEL_KEY[thinking_level])}
        </AppDropdownMenuRadioItem>
      ))}
    </AppDropdownMenuRadioGroup>
  );
}

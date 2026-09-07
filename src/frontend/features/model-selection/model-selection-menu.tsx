import { Boxes, Circle, CircleCheck } from "lucide-react";

import { MODEL_TYPES, type ModelThinkingLevel, type ModelUsage } from "@domain/model";
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
import type { ModelSelectionOption } from "@shared/model-selection";

type ModelSelectionMenuProps = {
  controller: ModelSelectionController;
  usage: ModelUsage;
  disabled?: boolean;
};

type ModelThinkingLevelOptionsProps = ModelSelectionMenuProps & {
  on_thinking_level_change?: (thinking_level: ModelThinkingLevel) => void;
};

/** 工作台当前模型入口，叶子一次提交模型及可选思考等级。 */
export function ModelSelectionMenu(
  props: Omit<ModelSelectionMenuProps, "usage"> & { usage: "translation" },
): JSX.Element {
  const { t } = useI18n();
  const selected = read_selected_model(props.controller, props.usage);
  const selected_name = selected?.name || selected?.id || t("app.model.selection.unavailable");
  const disabled = Boolean(props.disabled) || props.controller.loading || props.controller.updating;

  return (
    <AppDropdownMenuSub>
      <AppDropdownMenuSubTrigger disabled={disabled} title={selected_name}>
        <Boxes aria-hidden="true" />
        <span className="max-w-72 truncate">{selected_name}</span>
      </AppDropdownMenuSubTrigger>
      <AppDropdownMenuSubContent>
        <ModelSelectionOptions
          mode="model_and_thinking"
          models={props.controller.snapshot.models}
          value={props.controller.snapshot.model_selection.translation}
          disabled={disabled}
          on_select={(change) => {
            void props.controller.select_model({ target: "translation", ...change });
          }}
        />
      </AppDropdownMenuSubContent>
    </AppDropdownMenuSub>
  );
}

/** 模型选项只表达模型及可选等级，消费方决定目标用途与提交命令。 */
export function ModelSelectionOptions(props: {
  mode: "model" | "model_and_thinking";
  models: readonly ModelSelectionOption[];
  value: string;
  disabled?: boolean;
  on_select: (change: { model_id: string; thinking_level?: ModelThinkingLevel }) => void;
}): JSX.Element {
  const { t } = useI18n();
  const selected_id = props.value;
  const selected = props.models.find((model) => model.id === selected_id);
  const disabled = Boolean(props.disabled);

  return (
    <>
      {MODEL_TYPES.map((model_type) => {
        const models = props.models.filter((model) => model.type === model_type);
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
              <AppDropdownMenuRadioGroup value={selected_id}>
                {models.map((model) =>
                  props.mode === "model_and_thinking" ? (
                    <AppDropdownMenuSub key={model.id}>
                      <AppDropdownMenuSubTrigger
                        disabled={disabled}
                        title={model.name || model.id}
                        aria-current={model.id === selected_id ? "true" : undefined}
                      >
                        {model.id === selected_id ? (
                          <CircleCheck aria-hidden="true" />
                        ) : (
                          <Circle aria-hidden="true" />
                        )}
                        <span className="max-w-72 truncate">{model.name || model.id}</span>
                      </AppDropdownMenuSubTrigger>
                      <AppDropdownMenuSubContent>
                        {model.available_thinking_levels.length > 0 ? (
                          <ThinkingLevelOptions
                            model={model}
                            disabled={disabled}
                            on_select={(thinking_level) =>
                              props.on_select({ model_id: model.id, thinking_level })
                            }
                          />
                        ) : (
                          // 默认叶子只选择模型，省略等级以沿用模型配置。
                          <AppDropdownMenuRadioItem
                            value={model.id}
                            disabled={disabled}
                            onClick={() => props.on_select({ model_id: model.id })}
                          >
                            {t("app.model.thinking_level.default")}
                          </AppDropdownMenuRadioItem>
                        )}
                      </AppDropdownMenuSubContent>
                    </AppDropdownMenuSub>
                  ) : (
                    <AppDropdownMenuRadioItem
                      key={model.id}
                      value={model.id}
                      disabled={disabled}
                      title={model.name || model.id}
                      onClick={() => props.on_select({ model_id: model.id })}
                    >
                      <span className="max-w-72 truncate">{model.name || model.id}</span>
                    </AppDropdownMenuRadioItem>
                  ),
                )}
              </AppDropdownMenuRadioGroup>
            </AppDropdownMenuSubContent>
          </AppDropdownMenuSub>
        );
      })}
    </>
  );
}

/** 当前用途模型的思考档位；消费页面可在保存前处理页面私有确认。 */
export function ModelThinkingLevelOptions(
  props: ModelThinkingLevelOptionsProps,
): JSX.Element | null {
  const selected = read_selected_model(props.controller, props.usage);
  if (selected === null) return null;
  return (
    <ThinkingLevelOptions
      model={selected}
      disabled={Boolean(props.disabled) || props.controller.loading || props.controller.updating}
      on_select={(level) => {
        if (level === selected.thinking_level) return;
        if (props.on_thinking_level_change === undefined) {
          void props.controller.update_thinking_level(props.usage, level);
        } else props.on_thinking_level_change(level);
      }}
    />
  );
}

/** 显式模型的等级叶子支持再次激活已选值，用于同时切换目标模型。 */
function ThinkingLevelOptions(props: {
  model: ModelSelectionOption;
  disabled: boolean;
  on_select: (level: ModelThinkingLevel) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  if (props.model.available_thinking_levels.length === 0) return null;
  return (
    <AppDropdownMenuRadioGroup value={props.model.thinking_level}>
      {props.model.available_thinking_levels.map((level) => (
        <AppDropdownMenuRadioItem
          key={level}
          value={level}
          disabled={props.disabled}
          onClick={() => props.on_select(level)}
        >
          {t(MODEL_THINKING_LEVEL_LABEL_KEY[level])}
        </AppDropdownMenuRadioItem>
      ))}
    </AppDropdownMenuRadioGroup>
  );
}

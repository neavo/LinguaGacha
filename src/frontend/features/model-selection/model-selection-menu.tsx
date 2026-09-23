import { Boxes, Circle, CircleCheck } from "lucide-react";

import { MODEL_TYPES, type ModelThinkingLevel, type ModelUsage } from "@domain/model";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  AppDropdownMenuRadioGroup,
  AppDropdownMenuRadioItem,
  AppDropdownMenuItem,
  AppDropdownMenuSub,
  AppDropdownMenuSubContent,
  AppDropdownMenuSubTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { useAppDropdownMenuClose } from "@frontend/widgets/app-dropdown-menu-context";
import { read_selected_model, type ModelSelectionController } from "./use-model-selection";
import {
  MODEL_THINKING_LEVEL_LABEL_KEY,
  MODEL_TYPE_TITLE_KEY,
  read_model_thinking_level_label_key,
} from "./model-selection-meta";
import type { ModelSelectionInput, ModelSelectionOption } from "@shared/model-selection";

type ModelSelectionMenuProps = {
  controller: ModelSelectionController;
  usage: ModelUsage;
  disabled?: boolean;
};

/** 工作台当前模型入口，模型行直接选择，等级叶子一次提交模型与等级。 */
export function ModelSelectionMenu(
  props: Omit<ModelSelectionMenuProps, "usage"> & { usage: "translation" },
): JSX.Element {
  const { t } = useI18n();
  const selected = read_selected_model(props.controller, props.usage);
  const selected_name = selected?.name || selected?.id || t("app.model.selection.unavailable");
  const thinking_label =
    selected === null ? null : t(read_model_thinking_level_label_key(selected));
  const disabled = Boolean(props.disabled) || props.controller.loading || props.controller.updating;

  return (
    <AppDropdownMenuSub>
      <AppDropdownMenuSubTrigger
        className="max-w-80"
        disabled={disabled}
        title={thinking_label === null ? selected_name : `${selected_name} · ${thinking_label}`}
      >
        <Boxes aria-hidden="true" />
        <span className="min-w-0 max-w-72 truncate">{selected_name}</span>
        {thinking_label === null ? null : <span className="shrink-0">· {thinking_label}</span>}
      </AppDropdownMenuSubTrigger>
      <AppDropdownMenuSubContent>
        <ModelSelectionOptions
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
  models: readonly ModelSelectionOption[];
  value: string;
  disabled?: boolean;
  on_select: (change: ModelSelectionInput) => void;
}): JSX.Element {
  const { t } = useI18n();
  const close = useAppDropdownMenuClose();
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
              {models.map((model) =>
                model.available_thinking_levels.length > 0 ? (
                  <AppDropdownMenuSub key={model.id}>
                    <AppDropdownMenuSubTrigger
                      disabled={disabled}
                      title={model.name || model.id}
                      aria-current={model.id === selected_id ? "true" : undefined}
                      onClick={() => {
                        props.on_select({ model_id: model.id });
                        // 子菜单触发项只负责展开，直接选模后需要关闭根菜单。
                        close();
                      }}
                    >
                      {model.id === selected_id ? (
                        <CircleCheck aria-hidden="true" />
                      ) : (
                        <Circle aria-hidden="true" />
                      )}
                      <span className="max-w-72 truncate">{model.name || model.id}</span>
                    </AppDropdownMenuSubTrigger>
                    <AppDropdownMenuSubContent>
                      <ThinkingLevelOptions
                        model={model}
                        disabled={disabled}
                        on_select={(thinking_level) =>
                          props.on_select({ model_id: model.id, thinking_level })
                        }
                      />
                    </AppDropdownMenuSubContent>
                  </AppDropdownMenuSub>
                ) : (
                  <AppDropdownMenuItem
                    key={model.id}
                    disabled={disabled}
                    title={model.name || model.id}
                    aria-current={model.id === selected_id ? "true" : undefined}
                    onClick={() => props.on_select({ model_id: model.id })}
                  >
                    {model.id === selected_id ? (
                      <CircleCheck aria-hidden="true" />
                    ) : (
                      <Circle aria-hidden="true" />
                    )}
                    <span className="max-w-72 truncate">{model.name || model.id}</span>
                  </AppDropdownMenuItem>
                ),
              )}
            </AppDropdownMenuSubContent>
          </AppDropdownMenuSub>
        );
      })}
    </>
  );
}

/** 显式模型的等级叶子支持再次激活已选值，用于同时切换目标模型。 */
function ThinkingLevelOptions(props: {
  model: ModelSelectionOption;
  disabled: boolean;
  on_select: (level: ModelThinkingLevel) => void;
}): JSX.Element {
  const { t } = useI18n();
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

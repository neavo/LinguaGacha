import type { ModelThinkingLevel, ModelType } from "@domain/model";
import type { LocaleKey } from "@frontend/app/locale/locale-context";
import type { ModelSelectionOption } from "@shared/model-selection";

/** 模型管理页与任务选择菜单共享同一类型标题词表。 */
export const MODEL_TYPE_TITLE_KEY = {
  PRESET: "app.model.type.preset",
  CUSTOM_GOOGLE: "app.model.type.google",
  CUSTOM_OPENAI: "app.model.type.openai",
  CUSTOM_OPENAI_RESPONSES: "app.model.type.openai_responses",
  CUSTOM_ANTHROPIC: "app.model.type.anthropic",
} as const satisfies Record<ModelType, LocaleKey>;

/** 模型管理与任务入口共享同一思考档位文案。 */
export const MODEL_THINKING_LEVEL_LABEL_KEY = {
  OFF: "app.model.thinking_level.off",
  LOW: "app.model.thinking_level.low",
  MEDIUM: "app.model.thinking_level.medium",
  HIGH: "app.model.thinking_level.high",
  XHIGH: "app.model.thinking_level.xhigh",
  MAX: "app.model.thinking_level.max",
} as const satisfies Record<ModelThinkingLevel, LocaleKey>;

/** 入口只显示模型实际可选的档位；不支持思考等级时沿用默认文案。 */
export function read_model_thinking_level_label_key(model: ModelSelectionOption): LocaleKey {
  return model.available_thinking_levels.includes(model.thinking_level)
    ? MODEL_THINKING_LEVEL_LABEL_KEY[model.thinking_level]
    : "app.model.thinking_level.default";
}

import type { ModelThinkingLevel, ModelType } from "@domain/model";
import type { LocaleKey } from "@frontend/app/locale/locale-provider";

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
} as const satisfies Record<ModelThinkingLevel, LocaleKey>;

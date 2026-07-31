import type { ModelType } from "@domain/model";
import type { LocaleKey } from "@frontend/app/locale/locale-provider";

/** 模型管理页与任务选择菜单共享同一类型标题词表。 */
export const MODEL_TYPE_TITLE_KEY = {
  PRESET: "app.model.type.preset",
  CUSTOM_GOOGLE: "app.model.type.google",
  CUSTOM_OPENAI: "app.model.type.openai",
  CUSTOM_ANTHROPIC: "app.model.type.anthropic",
} as const satisfies Record<ModelType, LocaleKey>;

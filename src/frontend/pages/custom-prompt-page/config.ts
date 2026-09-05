import type { LocaleKey } from "@frontend/app/locale/locale-provider";

export type CustomPromptVariant = "translation";

export type CustomPromptVariantConfig = {
  header_title_key: LocaleKey;
  header_description_key: LocaleKey;
  default_preset_settings_key: "translation_custom_prompt_default_preset";
};

export const CUSTOM_PROMPT_VARIANT_CONFIG: Record<CustomPromptVariant, CustomPromptVariantConfig> =
  {
    translation: {
      header_title_key: "translation_prompt_page.header.title",
      header_description_key: "translation_prompt_page.header.description_html",
      default_preset_settings_key: "translation_custom_prompt_default_preset",
    },
  };

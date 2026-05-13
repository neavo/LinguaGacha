import type { LocaleKey } from "@/app/locale/locale-provider";

export type TextReplacementVariant = "pre" | "post";

export type TextReplacementVariantConfig = {
  rule_type: "pre_replacement" | "post_replacement";
  default_preset_settings_key:
    | "pre_translation_replacement_default_preset"
    | "post_translation_replacement_default_preset";
  title_key: LocaleKey;
  export_file_name: string;
};

export const TEXT_REPLACEMENT_VARIANT_CONFIG: Record<
  TextReplacementVariant,
  TextReplacementVariantConfig
> = {
  pre: {
    rule_type: "pre_replacement",
    default_preset_settings_key: "pre_translation_replacement_default_preset",
    title_key: "pre_translation_replacement_page.title",
    export_file_name: "pre_translation_replacement.json",
  },
  post: {
    rule_type: "post_replacement",
    default_preset_settings_key: "post_translation_replacement_default_preset",
    title_key: "post_translation_replacement_page.title",
    export_file_name: "post_translation_replacement.json",
  },
};

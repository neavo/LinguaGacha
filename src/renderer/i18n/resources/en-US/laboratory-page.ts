import { zh_cn_laboratory_page } from "@/i18n/resources/zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "@/i18n/types";

export const en_us_laboratory_page = {
  title: "Laboratory",
  fields: {
    mtool_optimizer_enable: {
      title: "MTool Optimizer",
      description:
        "For MTool text, <emphasis> cuts translation time and tokens by up to 40%</emphasis>, enabled by default",
      help_label: "View the MTool Optimizer guide",
    },
    skip_duplicate_source_text_enable: {
      title: "Skip duplicate source text",
      description:
        "In one file, translate identical source text once, <emphasis>duplicates reuse the translated text</emphasis>, enabled by default",
    },
  },
  feedback: {
    refresh_failed: "Unable to refresh laboratory settings. Please try again …",
    update_failed: "Failed to save laboratory settings. Please try again …",
    mtool_optimizer_loading_toast: "Refreshing project cache …",
    skip_duplicate_source_text_loading_toast: "Refreshing project cache …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;

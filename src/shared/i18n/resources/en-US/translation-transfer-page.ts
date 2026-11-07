import { zh_cn_translation_transfer_page } from "../zh-CN/translation-transfer-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_translation_transfer_page = {
  title: "Translation transfer",
  fields: {
    source: { title: "Source project" },
    base: { title: "Base project" },
    mode: {
      title: "Transfer mode",
      fill: "Fill",
      overwrite: "Overwrite",
      fill_description: "On conflict, keep the translation in the base project",
      overwrite_description: "On conflict, use the translation from the source project",
    },
  },
  action: { start: "Generate new project" },
  feedback: {
    result: "Filled {FILLED} · Replaced {REPLACED} · Unmatched {UNMATCHED}",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_translation_transfer_page>;

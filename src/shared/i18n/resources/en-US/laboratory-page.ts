import { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_laboratory_page = {
  title: "Laboratory",
  fields: {
    mtool_optimizer_enable: {
      title: "MTool optimizer",
      description:
        "For MTool text, <emphasis>cuts translation time and tokens by up to 40%</emphasis>. Enabled by default.",
    },
    skip_duplicate_source_text_enable: {
      title: "Skip duplicate source text",
      description:
        "Entries with identical text across the project share <emphasis>one translation</emphasis>. Enabled by default.",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;

import { zh_cn_toolbox_page } from "@/i18n/resources/zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "@/i18n/types";

export const en_us_toolbox_page = {
  title: "Toolbox",
  entries: {
    name_field_extraction: {
      title: "Name-Field Extraction",
      description:
        "Extract character name field data from <emphasis>RenPy</emphasis> and <emphasis>GalGame</emphasis> game text, and automatically generate corresponding glossary data to facilitate subsequent translation",
    },
    ts_conversion: {
      title: "TS Conversion",
      description:
        "Batch convert the target text or character names between Traditional and Simplified Chinese with text protection",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;

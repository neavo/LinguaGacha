import { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_laboratory_page = {
  title: "Labor",
  fields: {
    mtool_optimizer_enable: {
      title: "MTool-Optimierer",
      description:
        "Für MTool-Text <emphasis>reduziert dies die Übersetzungszeit und Token um bis zu 40%</emphasis>. Standardmäßig aktiviert.",
    },
    skip_duplicate_source_text_enable: {
      title: "Doppelten Ausgangstext überspringen",
      description:
        "Einträge mit identischem Text im gesamten Projekt teilen <emphasis>eine Übersetzung</emphasis>. Standardmäßig aktiviert.",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;

import { zh_cn_glossary_page } from "../zh-CN/glossary-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_glossary_page = {
  title: "Glossar",
  toggle: {
    tooltip:
      "Ein Glossar in Prompts einbauen, um die Übersetzung zu leiten, die Terminologie konsistent zu halten und Charaktereigenschaften zu korrigieren",
  },
  fields: {
    translation: "Übersetzung",
    description: "Beschreibung",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;

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
  feedback: {
    load_failed: "Glossar konnte nicht geladen werden. Bitte später erneut versuchen …",
    query_failed: "Fehler bei der Korrekturabfrage",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;

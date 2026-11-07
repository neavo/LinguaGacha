import { zh_cn_glossary_page } from "../zh-CN/glossary-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_glossary_page = {
  title: "Glossário",
  toggle: {
    tooltip:
      "Inclui um glossário nos prompts para orientar a tradução, manter a consistência terminológica e corrigir atributos de personagens",
  },
  fields: {
    translation: "Tradução",
    info: "Nota",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;

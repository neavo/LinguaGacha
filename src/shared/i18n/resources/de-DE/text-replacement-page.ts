import { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_text_replacement_page = {
  title: "Textersetzung",
  fields: {
    replacement: "Ersetzung",
  },
  rule: {
    regex: "Regulärer Ausdruck",
  },
  feedback: {
    load_failed: "Ersetzungsregeln konnten nicht geladen werden. Bitte später erneut versuchen …",
    query_failed: "Fehler bei der Abfrage der Ersetzungsregel",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;

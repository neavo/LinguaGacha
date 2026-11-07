import { zh_cn_translation_transfer_page } from "../zh-CN/translation-transfer-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_translation_transfer_page = {
  title: "Transferência de tradução",
  fields: {
    source: { title: "Projeto de origem" },
    base: { title: "Projeto base" },
    mode: {
      title: "Modo de transferência",
      fill: "Preencher",
      overwrite: "Sobrescrever",
      fill_description: "Em caso de conflito, mantém a tradução existente no projeto base",
      overwrite_description: "Em caso de conflito, usa a tradução do projeto de origem",
    },
  },
  action: { start: "Gerar novo projeto" },
  feedback: {
    result: "Preenchidos: {FILLED} · Substituídos: {REPLACED} · Não correspondidos: {UNMATCHED}",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_translation_transfer_page>;

import { zh_cn_translation_transfer_page } from "../zh-CN/translation-transfer-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_translation_transfer_page = {
  title: "Transferência de Tradução",
  fields: {
    source: { title: "Projeto de Origem" },
    base: { title: "Projeto Base" },
    mode: {
      title: "Modo de Transferência",
      fill: "Preencher",
      overwrite: "Substituir",
      fill_description: "Em caso de conflito, mantém a tradução existente no projeto base",
      overwrite_description: "Em caso de conflito, usa a tradução do projeto de origem",
    },
  },
  action: { start: "Gerar Novo Projeto" },
  feedback: {
    result: "Preenchidos: {FILLED} · Substituídos: {REPLACED} · Não correspondidos: {UNMATCHED}",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_translation_transfer_page>;

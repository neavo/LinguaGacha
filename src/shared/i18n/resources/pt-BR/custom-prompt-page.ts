import { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_custom_prompt_page = {
  save: {
    discard: "Descartar alterações não salvas",
    waiting: "Aguarde a conclusão da tarefa atual antes de salvar …",
  },
  title: "Prompts Personalizados",
  header: {
    description_html:
      "Adicione requisitos adicionais de tradução, como contexto da história e estilos de escrita, por meio de prompts personalizados",
  },
  section: {
    prefix_label: "Prefixo Fixo",
    suffix_label: "Sufixo Fixo",
  },
  confirm: {
    reset: {
      description: "Confirma a redefinição dos dados …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;

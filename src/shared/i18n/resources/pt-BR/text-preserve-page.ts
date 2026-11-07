import { zh_cn_text_preserve_page } from "../zh-CN/text-preserve-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_text_preserve_page = {
  title: "Preservação de texto",
  mode: {
    label: "Modo de preservação de texto",
    content_html:
      "Preserva trechos de texto como fragmentos de código, caracteres de controle e tags de estilo que não devem ser traduzidos, evitando traduções incorretas" +
      "<br>" +
      "• Desativado - Não utiliza regras de proteção, deixando o julgamento e processamento inteiramente a cargo da IA" +
      "<br>" +
      "• Inteligente - Determina automaticamente o formato do texto e a engine do jogo para selecionar regras de proteção adequadas" +
      "<br>" +
      "• Personalizado - Protege o texto correspondente com base nas <font color='darkgoldenrod'><b>Regras Regex</b></font> configuradas nesta página",
    options: {
      off: "Desativado",
      smart: "Inteligente",
      custom: "Personalizado",
    },
  },
  fields: {
    note: "Observações (apenas para referência, sem efeito prático)",
  },
  filter: {
    scope: {
      rule: "Regra",
      note: "Observações",
    },
  },
  feedback: {
    unknown_error: "A operação falhou. Tente novamente mais tarde …",
    mode_refresh_pending:
      "O modo de preservação de texto foi atualizado e o cache de revisão ainda está sendo atualizado. Verifique novamente em breve …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_preserve_page>;

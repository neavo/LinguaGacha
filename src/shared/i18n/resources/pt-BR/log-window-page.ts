import { zh_cn_log_window_page } from "../zh-CN/log-window-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_log_window_page = {
  title: "Registros",
  history: {
    date: "Data do registro",
    expired: "Os registros desta data foram removidos",
  },
  level: {
    all: "Todos",
    debug: "Depuração",
    info: "Informação",
    warning: "Aviso",
    error: "Erro",
    fatal: "Fatal",
  },
  fields: {
    time: "Hora",
    message: "Mensagem",
  },
  action: {
    return_to_top: "Voltar ao topo",
  },
  search: {
    placeholder: "Pesquisar nos registros carregados…",
    clear: "Limpar",
    regex: "Regex",
    regex_tooltip_label: "Modo Regex",
    regex_invalid: "Expressão regular inválida",
    scope: {
      label: "Escopo",
      tooltip_label: "Escopo do Registro",
    },
  },
  detail: {
    title: "Detalhe",
    previous: "Entrada Anterior",
    next: "Próxima Entrada",
    maximize: "Maximizar",
    minimize: "Minimizar",
    empty: "Selecione uma entrada de registro para ver os detalhes …",
    loading: "Carregando detalhes do registro …",
    unavailable:
      "Os detalhes do registro foram liberados da memória do processo atual. Verifique o arquivo de registro …",
    content: {
      source_text: "Texto Original",
      translated_text: "Tradução",
      error: "Detalhes do Erro",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_log_window_page>;

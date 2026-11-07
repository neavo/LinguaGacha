import { zh_cn_log_window_page } from "../zh-CN/log-window-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_log_window_page = {
  title: "Logs",
  history: {
    date: "Data do log",
    expired: "Os logs desta data foram removidos",
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
    placeholder: "Pesquisar nos logs carregados…",
    clear: "Limpar",
    regex: "Regex",
    regex_tooltip_label: "Modo Regex",
    regex_invalid: "Expressão regular inválida",
    scope: {
      label: "Escopo",
      tooltip_label: "Escopo do log",
    },
  },
  detail: {
    title: "Detalhe",
    previous: "Entrada anterior",
    next: "Próxima entrada",
    maximize: "Maximizar",
    minimize: "Minimizar",
    empty: "Selecione uma entrada de log para ver os detalhes …",
    loading: "Carregando detalhes do log …",
    unavailable:
      "Os detalhes do log foram liberados da memória do processo atual. Verifique o arquivo de log …",
    content: {
      source_text: "Texto original",
      translated_text: "Tradução",
      error: "Detalhes do erro",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_log_window_page>;

import { zh_cn_batch_translation } from "../zh-CN/batch-translation";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_batch_translation = {
  menu: {
    progress: "Progresso",
    tooltip: "Traduzir o texto original para o idioma de destino",
  },
  summary: {
    translation: { running: "Tradução em lote em andamento", stopping: "Parando tradução em lote" },
    request: {
      running: "Solicitações em lote em andamento",
      stopping: "Parando solicitações em lote",
    },
    mixed: { running: "Tarefas em lote em andamento", stopping: "Parando tarefas em lote" },
    empty: "Ocioso",
    stopping: "Parando",
    detail_tooltip: "Clique para ver detalhes",
  },
  detail: {
    waveform_title: "Velocidade em tempo real",
    provider: "Provedor",
    custom_thinking: "Personalizado",
    elapsed_time: "Tempo decorrido",
    remaining_time: "Tempo restante",
    average_speed: "Velocidade média",
    input_tokens: "Tokens de entrada",
    reasoning_tokens: "Tokens de raciocínio",
    output_tokens: "Tokens de saída",
    active_requests: "Tarefas ativas",
  },
  feedback: {
    stats_refresh_failed: "Falha ao atualizar as estatísticas de tradução do projeto …",
    done: "Tradução concluída …",
    stopped: "Tradução interrompida …",
    ended: "Tradução finalizada …",
    retry_exhausted: "{count} itens ainda falharam após repetidas tentativas e foram ignorados …",
    keys_retry_wait:
      "Erro de API. Nova tentativa automática em {seconds} segundos. Tentativas: {count} …",
    keys_retry_running: "Erro de API. Tentando novamente …",
    start_failed: "Falha ao iniciar a tarefa de tradução …",
    stop_failed: "Falha ao interromper as tarefas em lote …",
    reset_all_failed: "Falha ao redefinir todo o progresso de tradução …",
  },
  confirm: {
    reset_all_description: "Confirma a redefinição do progresso de tradução de todo o projeto …?",
    stop_description: "Interromper as tarefas em lote atuais …?",
  },
  action: { stop: "Parar" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;

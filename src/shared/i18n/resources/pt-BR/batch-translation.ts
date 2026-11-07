import { zh_cn_batch_translation } from "../zh-CN/batch-translation";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_batch_translation = {
  menu: {
    progress: "Progresso",
    tooltip: "Traduzir o texto de origem para o idioma de destino",
  },
  summary: {
    empty: "Ocioso",
    stopping: "Parando",
    detail_tooltip: "Clique para ver detalhes",
    running: "Traduzindo",
  },
  detail: {
    provider: "Provedor",
    elapsed_time: "Tempo Decorrido",
    remaining_time: "Tempo Restante",
    average_speed: "Velocidade Média",
    input_tokens: "Tokens de Entrada",
    reasoning_tokens: "Tokens de Raciocínio",
    output_tokens: "Tokens de Saída",
    waveform_title: "Velocidade em Tempo Real",
    metrics_title: "Estatísticas",
    active_requests: "Tarefas em Tempo Real",
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
    refresh_failed: "Falha ao atualizar a tarefa de tradução …",
    start_failed: "Falha ao iniciar a tarefa de tradução …",
    stop_failed: "Falha ao interromper a tarefa de tradução …",
    reset_all_failed: "Falha ao redefinir todo o progresso de tradução …",
  },
  confirm: {
    reset_all_description: "Confirma a redefinição do progresso de tradução de todo o projeto …?",
    stop_description: "Confirma a interrupção da tarefa de tradução atual …?",
  },
  action: { stop: "Parar" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;

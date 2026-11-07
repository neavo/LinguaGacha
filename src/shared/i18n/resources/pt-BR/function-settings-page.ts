import { zh_cn_function_settings_page } from "../zh-CN/function-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_function_settings_page = {
  title: "Configurações de Funções",
  fields: {
    preceding_lines_threshold: {
      title: "Entradas de Contexto Anterior",
      description:
        "Define o número de entradas de texto anteriores incluídas como contexto em cada tarefa. Isso aumenta o consumo de tokens. Desativado por padrão.",
    },
    following_lines_threshold: {
      title: "Entradas de Contexto Posterior",
      description:
        "Define o número de entradas de texto posteriores incluídas como contexto em cada tarefa. Isso aumenta o consumo de tokens. Desativado por padrão.",
    },
    request_timeout: {
      title: "Tempo Limite de Requisição",
      description:
        "Tempo máximo de espera por uma resposta do modelo, em segundos. A tarefa falha se nenhuma resposta for recebida a tempo.",
    },
    project_save_mode: {
      title: "Local de Salvamento do Projeto",
      description: "Define o local de salvamento dos arquivos de projeto ao criar um novo projeto",
      options: {
        manual: "Escolher a cada vez",
        fixed: "Diretório fixo",
        source: "Junto aos arquivos de origem",
      },
    },
    translation_save_mode: {
      title: "Local de Salvamento da Tradução",
      description: "Define onde os arquivos traduzidos são salvos ao gerar as traduções",
      options: {
        manual: "Escolher a cada vez",
        fixed: "Diretório fixo",
        project: "Junto ao arquivo de projeto",
      },
    },
    output_folder_open_on_finish: {
      title: "Abrir Pasta de Saída ao Gerar o Arquivo Traduzido",
      description:
        "Quando ativado, a pasta de saída será aberta após o arquivo traduzido ser gerado com sucesso",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "A contagem de entradas de contexto anterior deve ser um número inteiro de 0 a 9999999 …",
    following_lines_threshold_invalid:
      "A contagem de entradas de contexto posterior deve ser um número inteiro de 0 a 9999999 …",
    request_timeout_invalid:
      "O tempo limite de requisição deve ser um número dentro do intervalo válido …",
    pick_directory_failed:
      "Falha na seleção de diretório. Escolha o diretório fixo de salvamento novamente …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_function_settings_page>;

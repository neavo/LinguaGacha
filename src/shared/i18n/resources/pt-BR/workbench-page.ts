import { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_workbench_page = {
  title: "Bancada de trabalho",
  unit: {
    item: "Itens",
  },
  table: {
    file_name: "Nome do arquivo",
    progress: "Progresso",
  },
  feedback: {
    no_valid_file: "Nenhum arquivo válido pode ser adicionado",
  },
  action: {
    add_file: "Adicionar",
    rename: "Renomear",
    reset: "Redefinir dados do arquivo",
    translation_task: "Tradução",
    start_translation: "Iniciar tradução",
    reset_task_all: "Redefinir todos os dados",
  },
  dialog: {
    start_translation: {
      agent_recommended: "Recomendamos usar o AGENT para traduções de maior qualidade …!",
      agent_required:
        "Este projeto contém dados complexos que devem ser tratados pelo AGENT. Recomendamos usar o AGENT para traduções de maior qualidade …!",
      translate_directly: "Traduzir diretamente",
    },
    import_conflict: {
      description: "{COUNT} arquivos com o mesmo nome foram detectados. Escolha como tratá-los …",
    },
    inherit_import: {
      description: "Usar traduções já concluídas para preencher os arquivos importados …?",
      fill: "Preencher",
      do_not_fill: "Não preencher",
    },
    rename: {
      exists: "Já existe um arquivo ou pasta com esse nome",
      invalid_name:
        'O nome não pode estar vazio, conter \\ / : * ? " < > |, nem terminar com ponto',
    },
    reset: {
      description:
        "Confirma a redefinição do arquivo selecionado e de todas as suas entradas de tradução …?",
    },
    delete: {
      description:
        "Confirma a exclusão do arquivo selecionado e de todas as suas entradas de tradução …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>;

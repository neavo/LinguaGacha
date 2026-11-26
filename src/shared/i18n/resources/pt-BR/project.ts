import { zh_cn_project } from "../zh-CN/project";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_project = {
  language: {
    short: {
      ALL: "ALL",
      ZH: "ZH",
      "ZH-HANT": "ZH-HANT",
      EN: "EN",
      JA: "JA",
      KO: "KO",
      RU: "RU",
      AR: "AR",
      DE: "DE",
      FR: "FR",
      PL: "PL",
      ES: "ES",
      IT: "IT",
      PT: "PT",
      HU: "HU",
      TR: "TR",
      TH: "TH",
      ID: "ID",
      VI: "VI",
    },
    title: "Idiomas do projeto",
    source_description: "Define o idioma do texto original",
    target_description: "Define o idioma do texto traduzido",
  },
  create: {
    title: "Criar projeto",
    loading_toast: "Criando projeto …",
    success: "Projeto criado …",
    default_preset_loaded: "Predefinições padrão carregadas: {NAMES} …",
    default_presets: {
      glossary: "Glossário",
      text_preserve: "Preservação de texto",
      pre_translation_replacement: "Substituição pré-tradução",
      post_translation_replacement: "Substituição pós-tradução",
      translation_prompt: "Prompt de tradução",
    },
  },
  open: {
    title: "Abrir projeto",
    drop_title: "Clique ou arraste um arquivo .lg",
    loading_toast: "Carregando projeto …",
    remove_unavailable:
      "Não é possível remover esta entrada recente de projeto no momento. Tente novamente mais tarde …",
    newer_app_version_description:
      "Este arquivo foi criado para a versão do aplicativo <emphasis>v{VERSION}</emphasis>. Abri-lo com uma versão mais antiga pode corromper dados. Confirma que deseja continuar …?",
    missing_file_description: "O arquivo de projeto é inválido. Deseja removê-lo da lista …?",
  },
  rename: "Renomear projeto",
  close: {
    action: "Fechar",
    confirm: "Confirma o fechamento do projeto atual …?",
    failed: "Falha ao fechar o projeto. Tente novamente mais tarde …",
  },
  preview: {
    file_count: "Contagem de arquivos",
    files: "{COUNT} arquivos",
    created_at: "Criado em",
    updated_at: "Última atualização",
    progress: "Progresso",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_project>;

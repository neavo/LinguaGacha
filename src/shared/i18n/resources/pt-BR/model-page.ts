import { zh_cn_model_page } from "../zh-CN/model-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_model_page = {
  auth: {
    open_login_page: "Abrir página de login no navegador padrão",
    copy_link: "Copiar link",
    copied: "Copiado",
    success: "Clique para entrar …",
    login: "Clique para entrar",
    logout: "Sair",
  },
  title: "Gerenciamento de modelos",
  category: {
    preset: {
      description: "Modelos predefinidos integrados ao aplicativo",
    },
    custom_google: {
      description: "Modelos personalizados compatíveis com o formato da API Google Gemini",
    },
    custom_openai: {
      description: "Modelos personalizados compatíveis com o formato da API OpenAI",
    },
    custom_openai_responses: {
      description: "Modelos personalizados compatíveis com o formato da API OpenAI Responses",
    },
    custom_anthropic: {
      description: "Modelos personalizados compatíveis com o formato da API Anthropic Claude",
    },
  },
  copy_name: "{NAME}_cópia",
  action: {
    reset: "Redefinir modelo",
    delete: "Excluir modelo",
    copy: "Duplicar",
    basic_settings: "Configurações básicas",
    task_settings: "Configurações da tarefa",
    advanced_settings: "Configurações avançadas",
    input: "Entrada",
    fetch: "Buscar",
    test: "Testar",
  },
  dialog: {
    selector: {
      loading: "Carregando lista de modelos …",
      search_placeholder: "Filtrar modelos …",
      empty: "Sem dados válidos …",
    },
  },
  confirm: {
    logout: { description: "Confirma a saída da conta …?" },
    delete: {
      description: "Confirma a exclusão do modelo …?",
    },
    reset: {
      description: "Confirma a redefinição do modelo …?",
    },
  },
  feedback: {
    copy_success: "Modelo duplicado\nGrupo: {CATEGORY}\nNome: {NAME}",
    delete_last_one: "Pelo menos um modelo deve permanecer em cada categoria …",
    agent_limits_adjusted: "Configurações inválidas foram ajustadas para valores válidos …",
    json_format_error: "Erro no formato JSON. Insira um objeto JSON válido …",
    test_failed: "Falha ao testar o modelo. Tente novamente mais tarde …",
  },
  fields: {
    speed: {
      ultrafast: "UltraFast",
      default_description:
        "Deixa o nível de velocidade não especificado e usa o padrão da plataforma.",
      title: "Nível de velocidade",
      description:
        "Define o nível de velocidade do modelo. O provedor determina se terá efeito. Cobranças adicionais podem se aplicar.",
      standard: "Padrão",
      fast: "Rápido",
      default: "Manter padrão",
    },
    context_window: {
      title: "Janela de contexto",
      description: "Aplica-se apenas às tarefas do AGENT; 0 = automático",
    },
    max_output_tokens: {
      title: "Comprimento máximo de saída",
      description: "Aplica-se apenas às tarefas do AGENT; 0 = automático",
    },
    name: {
      title: "Nome do modelo",
      description: "Insira um nome para o modelo usado apenas para exibição no aplicativo",
      placeholder: "Digite o nome do modelo …",
    },
    api_url: {
      title: "URL da API",
      description:
        "Verifique a URL abaixo com atenção para evitar erros, como a falta ou excesso de /v1",
      placeholder: "Digite a URL da API …",
    },
    api_key: {
      title: "Chave de API",
      description:
        "Insira a chave de API, ex.: sk-d0daba12345678fd8eb7b8d31c123456; várias chaves podem ser inseridas para rotação, uma por linha",
      placeholder: "Digite a chave de API …",
    },
    model_id: {
      title: "Identificador do modelo",
      description: "Identificador do modelo atual: {MODEL}",
      placeholder: "Digite o identificador do modelo …",
    },
    thinking: {
      title: "Nível de raciocínio",
      description:
        "Configura o comportamento de raciocínio do modelo, afetando o tempo e consumo de tokens",
    },
    input_token_limit: {
      title: "Limite de tokens de entrada",
      description: "Número máximo de tokens permitidos para a entrada de cada tarefa",
    },
    output_token_limit: {
      title: "Limite de tokens de saída",
      description: "Número máximo de tokens permitidos para a saída de cada tarefa, 0 = Automático",
    },
    rpm_limit: {
      title: "Limite de requisições por minuto (RPM)",
      description: "Limita quantas requisições este modelo pode enviar por minuto, 0 = Automático",
    },
    concurrency_limit: {
      title: "Limite de tarefas simultâneas",
      description: "Limita quantas tarefas este modelo pode executar em paralelo, 0 = Automático",
    },
    top_p: {
      title: "top_p",
      description: "Tenha cuidado, valores inválidos podem causar erros",
    },
    temperature: {
      title: "temperature",
      description: "Tenha cuidado, valores inválidos podem causar erros",
    },
    extra_headers: {
      title: "Cabeçalhos de requisição personalizados",
      description:
        "Configure com cautela; valores incorretos podem causar resultados anormais ou erros de requisição",
      placeholder: 'Exemplo: {"Authorization": "Bearer xxx"}',
    },
    extra_body: {
      title: "Corpo de requisição personalizado",
      description:
        "Configure com cautela; valores incorretos podem causar resultados anormais ou erros de requisição",
      placeholder: 'Exemplo: {"seed": 42}',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_model_page>;

import { zh_cn_quality_rule_editor } from "../zh-CN/quality-rule-editor";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_quality_rule_editor = {
  confirm: {
    delete_selection: {
      description: "Confirma a exclusão de {COUNT} registros …?",
    },
    reset: {
      description: "Confirma a redefinição dos dados …?",
    },
  },
  feedback: {
    regex_invalid: "Expressão regular inválida",
    source_required: "O texto de origem é obrigatório",
  },
  fields: {
    rule: "Regra",
    source: "Origem",
    hit: "Correspondências",
  },
  filter: {
    clear: "Limpar",
    placeholder: "Consultar …",
    regex: "Regex",
    regex_tooltip_label: "Modo Regex",
    scope: {
      all: "Todos",
      label: "Escopo",
      tooltip_label: "Escopo da Pesquisa",
    },
  },
  hit: {
    hit_count: "Total de itens correspondentes: {COUNT}",
    relation_line: "{CHILD} -> {PARENT}",
    subset_relations: "Contém relações de subconjunto:",
    query_source: "Consultar origem",
    search_relation: "Consultar relações de subconjunto",
  },
  rule: { case_sensitive: "Diferenciar maiúsculas/minúsculas" },
} satisfies LocaleMessageSchema<typeof zh_cn_quality_rule_editor>;

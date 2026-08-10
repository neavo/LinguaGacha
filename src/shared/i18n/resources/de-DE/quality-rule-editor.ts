import { zh_cn_quality_rule_editor } from "../zh-CN/quality-rule-editor";
import type { LocaleMessageSchema } from "../../types";

export const de_de_quality_rule_editor = {
  confirm: {
    delete_selection: {
      description: "{COUNT} Einträge wirklich löschen …?",
    },
    reset: {
      description: "Daten wirklich zurücksetzen …?",
    },
  },
  feedback: {
    regex_invalid: "Ungültiger regulärer Ausdruck",
    source_required: "Quelltext ist erforderlich.",
  },
  fields: {
    rule: "Regel",
    source: "Quelle",
  },
  filter: {
    clear: "Löschen",
    placeholder: "Abfrage …",
    regex: "Regex",
    regex_tooltip_label: "Regex-Modus",
    scope: {
      all: "Alle",
      label: "Bereich",
      tooltip_label: "Suchbereich",
    },
  },
  sort: {
    ascending: "Aufsteigend",
    clear: "Löschen",
    descending: "Absteigend",
  },
  hit: {
    hit_count: "Anzahl übereinstimmender Einträge: {COUNT}",
    relation_line: "{CHILD} -> {PARENT}",
    subset_relations: "Enthält Teilmengenbeziehungen:",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_quality_rule_editor>;

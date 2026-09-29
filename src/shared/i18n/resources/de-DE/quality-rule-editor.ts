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
    source_required: "Quelltext ist erforderlich",
    save_failed: "Regeln konnten nicht gespeichert werden",
    update_failed: "Regeleinstellungen konnten nicht gespeichert werden",
    import_failed: "Regeln konnten nicht importiert werden",
    export_failed: "Regeln konnten nicht exportiert werden",
  },
  fields: {
    rule: "Regel",
    source: "Quelle",
    hit: "Treffer",
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
  hit: {
    hit_count: "Anzahl übereinstimmender Einträge: {COUNT}",
    relation_line: "{CHILD} -> {PARENT}",
    subset_relations: "Enthält Teilmengenbeziehungen:",
    query_source: "Quelle abfragen",
    search_relation: "Teilmengenbeziehungen abfragen",
  },
  rule: { case_sensitive: "Groß-/Kleinschreibung beachten" },
} satisfies LocaleMessageSchema<typeof zh_cn_quality_rule_editor>;

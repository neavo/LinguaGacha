import { zh_cn_quality_rule_editor } from "../zh-CN/quality-rule-editor";
import type { LocaleMessageSchema } from "../../types";

export const en_us_quality_rule_editor = {
  confirm: {
    delete_selection: {
      description: "Confirm deleting {COUNT} records …?",
    },
    reset: {
      description: "Confirm resetting data …?",
    },
  },
  feedback: {
    regex_invalid: "Invalid regular expression",
    source_required: "Source text is required.",
  },
  fields: {
    rule: "Rule",
    source: "Source",
  },
  filter: {
    clear: "Clear",
    placeholder: "Query …",
    regex: "Regex",
    regex_tooltip_label: "Regex Mode",
    scope: {
      all: "All",
      label: "Scope",
      tooltip_label: "Search Scope",
    },
  },
  sort: {
    ascending: "Ascending",
    clear: "Clear",
    descending: "Descending",
  },
  hit: {
    hit_count: "Matched item count: {COUNT}",
    relation_line: "{CHILD} -> {PARENT}",
    subset_relations: "Contains subset relations:",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_quality_rule_editor>;

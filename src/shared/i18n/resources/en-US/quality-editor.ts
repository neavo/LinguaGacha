import { zh_cn_quality_editor } from "../zh-CN/quality-editor";
import type { LocaleMessageSchema } from "../../types";

export const en_us_quality_editor = {
  action: {
    cancel: "Cancel",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    export: "Export",
    import: "Import",
    preset: "Preset",
    query: "Query",
    save: "Save",
  },
  confirm: {
    delete_preset: {
      description: "Confirm deleting preset …?",
    },
    delete_selection: {
      description: "Confirm deleting {COUNT} records …?",
    },
    overwrite_preset: {
      description: "Confirm overwriting preset …?",
    },
    reset: {
      description: "Confirm resetting data …?",
    },
  },
  feedback: {
    default_preset_cleared: "Default preset cancelled …",
    default_preset_set: "Default preset set …",
    export_success: "Data exported …",
    import_success: "Data imported …",
    preset_deleted: "Preset deleted …",
    preset_exists: "File already exists …",
    preset_name_required: "Preset name is required.",
    preset_renamed: "Preset renamed …",
    preset_saved: "Preset saved …",
    regex_invalid: "Invalid regular expression",
    reset_success: "Reset …",
    source_required: "Source text is required.",
  },
  fields: {
    drag: "Drag",
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
      source: "Source",
      tooltip_label: "Search Scope",
    },
  },
  preset: {
    apply: "Import",
    cancel_default: "Cancel Default Preset",
    delete: "Delete Preset",
    dialog: {
      name_placeholder: "Enter a preset name …",
      rename_confirm: "Rename",
      save_confirm: "Save",
    },
    rename: "Rename",
    save: "Save Preset",
    set_default: "Set as Default Preset",
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
  toggle: {
    status: "{TITLE} - {STATE}",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_quality_editor>;

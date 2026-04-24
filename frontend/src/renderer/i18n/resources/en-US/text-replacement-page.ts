import { zh_cn_text_replacement_page } from "@/i18n/resources/zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "@/i18n/types";

export const en_us_text_replacement_page = {
  title: "Text Replacement",
  action: {
    create: "Add",
    edit: "Edit",
    delete: "Delete",
    save: "Save",
    cancel: "Cancel",
    import: "Import",
    export: "Export",
    statistics: "Statistics",
    preset: "Preset",
    query: "Query",
  },
  toggle: {
    status: "{TITLE} - {STATE}",
  },
  fields: {
    drag: "Drag",
    source: "Source",
    replacement: "Replacement",
    rule: "Rule",
    statistics: "Hits",
  },
  rule: {
    regex: "Regular Expression",
    case_sensitive: "Case Sensitive",
  },
  filter: {
    placeholder: "Query …",
    clear: "Clear",
    regex: "Regex",
    regex_tooltip_label: "Regex Mode",
    scope: {
      label: "Scope",
      tooltip_label: "Search scope",
      all: "All",
      source: "Source",
      replacement: "Replacement",
    },
  },
  sort: {
    ascending: "Ascending",
    descending: "Descending",
    clear: "Clear",
  },
  dialog: {
    create_title: "Create Replacement Rule",
    edit_title: "Edit Replacement Rule",
  },
  preset: {
    save: "Save Preset",
    apply: "Import",
    rename: "Rename",
    delete: "Delete Preset",
    set_default: "Set as Default Preset",
    cancel_default: "Cancel Default Preset",
    dialog: {
      save_title: "Save as Preset",
      save_confirm: "Save",
      rename_title: "Rename Preset",
      rename_confirm: "Rename",
      name_placeholder: "Enter a preset name …",
    },
  },
  statistics: {
    hit_count: "Matched item count: {COUNT}",
    subset_relations: "Subset relations:",
    relation_line: "{CHILD} -> {PARENT}",
    running: "Running",
    action: {
      search_relation: "Search relation",
    },
  },
  confirm: {
    delete_selection: {
      description: "Confirm deleting {COUNT} records …?",
    },
    delete_entry: {
      description: "Confirm deleting 1 record …?",
    },
    delete_preset: {
      description: 'Confirm deleting preset "{NAME}" …?',
    },
    reset: {
      description: "Confirm resetting data …?",
    },
    overwrite_preset: {
      description: 'Confirm overwriting preset "{NAME}" …?',
    },
  },
  feedback: {
    save_failed: "Failed to save replacement page.",
    import_failed: "Failed to import replacement rules.",
    import_success: "Data imported …",
    export_failed: "Failed to export replacement rules.",
    export_success: "Data exported …",
    preset_failed: "Failed to load replacement presets.",
    preset_saved: "Preset saved …",
    preset_renamed: "Preset renamed …",
    preset_deleted: "Preset deleted …",
    preset_name_required: "Preset name is required.",
    preset_exists: "File already exists …",
    default_preset_set: "Default preset set …",
    default_preset_cleared: "Default preset cancelled …",
    query_failed: "Failed to query replacement rule.",
    source_required: "Source text is required.",
    regex_invalid: "Invalid regular expression",
    merge_warning: "Duplicate entries were merged …",
    reset_success: "Reset complete …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;

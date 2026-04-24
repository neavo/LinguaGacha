import { zh_cn_text_preserve_page } from "@/i18n/resources/zh-CN/text-preserve-page";
import type { LocaleMessageSchema } from "@/i18n/types";

export const en_us_text_preserve_page = {
  title: "Text Preserve",
  action: {
    create: "Create",
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
  mode: {
    label: "Text Preserve Mode",
    status: "{TITLE} - {STATE}",
    loading_toast: "Refreshing proofreading cache …",
    content_html:
      "Preserve text segments like code snippets, control characters, and style characters that shouldn't be translated, preventing incorrect translation" +
      "<br>" +
      "• Off - Does not use any protection rules, leaving judgment and processing entirely to the AI" +
      "<br>" +
      "• Smart - Automatically determines the text format and game engine to select appropriate protection rules" +
      "<br>" +
      "• Custom - Protects corresponding text matched based on the <font color='darkgoldenrod'><b>Regex Rules</b></font> configured on this page",
    options: {
      off: "Off",
      smart: "Smart",
      custom: "Custom",
    },
  },
  fields: {
    drag: "Drag",
    rule: "Rule",
    note: "Remarks (For reference only, no actual effect)",
    statistics: "Status",
  },
  filter: {
    placeholder: "Query …",
    clear: "Clear",
    regex: "Regex",
    regex_tooltip_label: "Regex Mode",
    scope: {
      label: "Scope",
      tooltip_label: "Search Scope",
      all: "All",
      rule: "Rule",
      note: "Remarks",
    },
  },
  sort: {
    ascending: "Ascending",
    descending: "Descending",
    clear: "Clear",
  },
  dialog: {
    create_title: "Create Text Preserve Rule",
    edit_title: "Edit Text Preserve Rule",
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
      name_placeholder: "Please enter preset name …",
    },
  },
  statistics: {
    hit_count: "Matched Item Count: {COUNT}",
    subset_relations: "Contains subset relations:",
    relation_line: "{CHILD} -> {PARENT}",
    running: "Calculating",
    action: {
      search_relation: "Search Contains Relation",
    },
  },
  confirm: {
    delete_selection: {
      description: "Confirm deleting {COUNT} records …?",
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
    import_success: "Data imported …",
    export_success: "Data exported …",
    preset_saved: "Preset saved …",
    preset_renamed: "Preset renamed …",
    preset_deleted: "Preset deleted …",
    preset_name_required: "Preset name cannot be empty",
    preset_exists: "File already exists …",
    default_preset_set: "Default preset set …",
    default_preset_cleared: "Default preset cleared …",
    unknown_error: "The operation failed. Please try again later.",
    regex_invalid: "Invalid regular expression",
    merge_warning: "Duplicate entries were merged …",
    reset_success: "Reset completed …",
    mode_refresh_pending:
      "The text preserve mode was updated, and the proofreading cache is still refreshing. Please check again shortly.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_preserve_page>;

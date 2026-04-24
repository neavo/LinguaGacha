import { zh_cn_name_field_extraction_page } from "@/i18n/resources/zh-CN/name-field-extraction-page";
import type { LocaleMessageSchema } from "@/i18n/types";

export const en_us_name_field_extraction_page = {
  title: "Name-Field Extraction",
  summary: {
    description:
      "Extract character name fields from RenPy and GalGame text, then generate glossary entries for later translation.",
    emphasis:
      "Supports string and array name_src fields, keeping the longest source text as context.",
  },
  fields: {
    drag: "Drag",
    source: "Source",
    translation: "Translation",
    context: "Context",
  },
  status: {
    translating: "Translating",
  },
  action: {
    extract: "Extract",
    extracting: "Extracting",
    translate: "Translate",
    translating: "Translating",
    import_glossary: "Import to Glossary",
    edit: "Edit",
    save: "Save",
    delete: "Delete",
  },
  dialog: {
    edit_title: "Edit Name Translation",
  },
  filter: {
    placeholder: "Query ...",
    clear: "Clear search",
    regex: "Regex",
    regex_tooltip_label: "Regex search",
    scope: {
      label: "Scope",
      tooltip_label: "Search scope",
      all: "All",
      source: "Source",
      translation: "Translation",
    },
  },
  mode: {
    status: "{TITLE}: {STATE}",
  },
  sort: {
    ascending: "Ascending",
    descending: "Descending",
    clear: "Clear sorting",
  },
  confirm: {
    delete_selection: {
      title: "Delete name entries",
      description: "{COUNT} name entries will be removed from the current page results.",
    },
  },
  feedback: {
    project_required: "Open a project first.",
    extract_success: "Extracted {COUNT} name fields.",
    extract_empty: "No name fields can be extracted.",
    no_pending_translation: "No names need translation.",
    no_importable_entries: "No name entries can be imported to the glossary.",
    import_success: "Imported to glossary.",
    import_failed: "Failed to import to glossary.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_name_field_extraction_page>;

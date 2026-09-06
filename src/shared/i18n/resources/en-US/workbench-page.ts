import { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_workbench_page = {
  title: "Workbench",
  unit: {
    line: "Line",
  },
  table: {
    file_name: "File Name",
    line_count: "Lines",
    actions: "Actions",
  },
  sort: {
    ascending: "Sort ascending",
    descending: "Sort descending",
    clear: "Clear sort",
  },
  feedback: {
    refresh_failed: "Failed to refresh workbench.",
    add_file_loading_toast: "Adding file and refreshing cache …",
    no_valid_file: "No valid files can be added.",
    file_action_failed: "File operation failed. Please try again later.",
    generate_translation_failed:
      "Failed to generate available translation files. Please try again later.",
    close_project_failed: "Failed to close the project. Please try again later.",
  },
  action: {
    add_file: "Add",
    generate_translation: "Generate Translation",
    close_project: "Close",
    reset: "Reset Translation",
    translation_task: "Translation",
    start_translation: "Start Translation",
    reset_task_all: "Reset All Data",
    reset_task_failed: "Reset Failed Data",
  },
  translation_export: {
    checking: "Checking proofreading warnings …",
    check_failed:
      "Proofreading warnings could not be loaded. You can still generate the current translation.",
    warning_description:
      "Detected {COUNT} proofreading warnings. We recommend using AGENT to review and fix them automatically before generating the translation. Continue anyway …?",
    warning_list: "Proofreading warnings",
    retry_check: "Check Again",
    continue_generate: "Generate Anyway",
  },
  reorder: {
    failed: "Failed to save the file order. Please try again later.",
  },
  dialog: {
    import_conflict: {
      description: "{COUNT} files with the same name were detected. Choose how to handle them …?",
    },
    inherit_import: {
      description: "Use completed translations from the current project to fill the new files …?",
      fill: "Fill",
      do_not_fill: "Do Not Fill",
    },
    reset: {
      description: "Confirm resetting this file's translation status …?",
    },
    delete: {
      description: "Confirm deleting the selected file and all of its translation entries …?",
    },
    close_project: {
      description: "Confirm closing the current project …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>;

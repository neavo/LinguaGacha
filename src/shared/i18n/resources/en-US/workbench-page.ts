import { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_workbench_page = {
  title: "Workbench",
  unit: {
    line: "Line",
  },
  table: {
    file_name: "File Name",
    progress: "Progress",
    agent: "AGENT",
    agent_only: "This file can only be translated using AGENT",
    actions: "Actions",
  },
  feedback: {
    add_file_loading_toast: "Adding file and refreshing cache …",
    no_valid_file: "No valid files can be added",
    close_project_failed: "Failed to close the project. Please try again later …",
  },
  action: {
    add_file: "Add",
    close_project: "Close",
    reset: "Reset Translation",
    translation_task: "Translation",
    start_translation: "Start Translation",
    reset_task_all: "Reset All Data",
    reset_task_failed: "Reset Failed Data",
  },
  dialog: {
    import_conflict: {
      description: "{COUNT} files with the same name were detected. Choose how to handle them …",
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

import { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_workbench_page = {
  title: "Workbench",
  unit: {
    item: "Items",
  },
  table: {
    file_name: "File name",
    progress: "Progress",
  },
  feedback: {
    no_valid_file: "No valid files can be added",
  },
  action: {
    add_file: "Add",
    rename: "Rename",
    reset: "Reset file data",
    translation_task: "Translation",
    start_translation: "Start translation",
    reset_task_all: "Reset all data",
  },
  dialog: {
    start_translation: {
      agent_recommended: "We recommend using AGENT for higher-quality translations …!",
      agent_required:
        "This project contains complex data that must be handled by AGENT. We recommend using AGENT for higher-quality translations …!",
      translate_directly: "Translate directly",
    },
    import_conflict: {
      description: "{COUNT} files with the same name were detected. Choose how to handle them …",
    },
    inherit_import: {
      description: "Use completed translations to fill the imported files …?",
      fill: "Fill",
      do_not_fill: "Do not fill",
    },
    rename: {
      exists: "A file or folder with this name already exists",
      invalid_name: 'Name must not be empty, contain \\ / : * ? " < > |, or end with a dot',
    },
    reset: {
      description: "Confirm resetting the selected file and all of its translation entries …?",
    },
    delete: {
      description: "Confirm deleting the selected file and all of its translation entries …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>;

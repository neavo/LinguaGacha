import { zh_cn_function_settings_page } from "../zh-CN/function-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_function_settings_page = {
  title: "Function Settings",
  fields: {
    source_language: {
      description: "Set the language of the input text",
    },
    target_language: {
      description: "Set the language of the output text",
    },
    preceding_lines_threshold: {
      title: "Preceding Context Entries",
      description:
        "Set the number of preceding text entries included as context in each task. This increases token usage. Disabled by default.",
    },
    following_lines_threshold: {
      title: "Following Context Entries",
      description:
        "Set the number of following text entries included as context in each task. This increases token usage. Disabled by default.",
    },
    request_timeout: {
      title: "Request Timeout",
      description:
        "Maximum wait for a model reply, in seconds. The task fails if no reply arrives in time.",
    },
    project_save_mode: {
      title: "Project Save Location",
      description: "Set the save location for project files when creating a new project",
      options: {
        manual: "Choose every time",
        fixed: "Fixed directory",
        source: "Next to source files",
      },
    },
    translation_save_mode: {
      title: "Translation Save Location",
      description: "Set where translation files are saved when generating translations",
      options: {
        manual: "Choose every time",
        fixed: "Fixed directory",
        project: "Next to the project file",
      },
    },
    output_folder_open_on_finish: {
      title: "Open Output Folder When Translation File Is Generated",
      description:
        "When enabled, the output folder will be opened after the translated file is generated successfully",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "The preceding context entry count must be an integer from 0 to 9999999 …",
    following_lines_threshold_invalid:
      "The following context entry count must be an integer from 0 to 9999999 …",
    request_timeout_invalid: "Request timeout must be a number within the valid range …",
    pick_directory_failed:
      "Directory selection failed. Please choose the fixed save directory again …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_function_settings_page>;

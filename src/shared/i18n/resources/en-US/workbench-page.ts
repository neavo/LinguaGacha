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
    stop_task: "Stop",
    analysis_task: "Analysis",
    start_analysis: "Start Analysis",
    import_analysis_glossary: "Import Candidate Terms",
  },
  task: {
    menu: {
      progress: "Progress",
    },
    summary: {
      empty: "Idle",
      stopping: "Stopping",
      detail_tooltip: "Click to view details",
    },
    detail: {
      elapsed_time: "Elapsed Time",
      remaining_time: "Remaining Time",
      average_speed: "Average Speed",
      input_tokens: "Input Tokens",
      output_tokens: "Output Tokens",
    },
    feedback: {
      done: "Completed …",
      stopped: "Stopped …",
    },
  },
  analysis_task: {
    menu: {
      tooltip: "Extract terms from source text",
    },
    migration: {
      description:
        "The classic Analysis task workflow will be removed soon …\nUse AGENT to generate the glossary automatically—faster and smarter …!",
      jump: "Go to AGENT",
      continue: "Continue Task",
    },
    summary: {
      running: "Analyzing",
    },
    detail: {
      title: "Analysis Details",
      description: "View live statistics for the current analysis.",
      waveform_title: "Live Speed",
      metrics_title: "Metrics",

      active_requests: "Active Requests",
      candidate_count: "Candidate Terms",
    },
    confirm: {
      reset_all_description: "Confirm resetting the analysis progress for the entire project …?",
      reset_failed_description: "Confirm resetting failed analysis progress …?",
      import_glossary_description: "Confirm importing candidate terms into the glossary …?",
      stop_description: "Confirm stopping the current analysis task …?",
    },
    feedback: {
      refresh_failed: "Failed to refresh analysis task state",
      start_failed: "Failed to start analysis task",
      stop_failed: "Failed to stop analysis task",

      reset_all_failed: "Failed to reset all analysis progress",
      reset_failed_failed: "Failed to reset failed analysis progress",
      import_loading_toast: "Importing candidate terms and refreshing proofreading cache …",
      import_failed: "Failed to import candidate terms",
      import_success: "Imported {COUNT} candidate terms",
      agent_draft_preserved: "The existing AGENT draft was preserved.",
    },
  },
  translation_task: {
    menu: {
      tooltip: "Translate source text into the target language",
    },
    summary: {
      running: "Translating",
    },
    detail: {
      title: "Translation Details",
      description: "Review current translation statistics.",
      waveform_title: "Real-time Speed",
      metrics_title: "Statistics",

      active_requests: "Real Time Tasks",
    },
    confirm: {
      reset_all_description: "Confirm resetting the translation progress for the entire project …?",
      reset_failed_description: "Confirm resetting failed translation entries …?",
      generate_description: "Confirm generating currently available translation files …?",
      stop_description: "Confirm stopping the current translation task …?",
    },
    feedback: {
      refresh_failed: "Failed to refresh the translation task.",
      start_failed: "Failed to start the translation task.",
      stop_failed: "Failed to stop the translation task.",

      reset_all_failed: "Failed to reset all translation progress.",
      reset_failed_failed: "Failed to reset failed translation entries.",
      generate_failed: "Failed to generate available translation files.",
    },
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

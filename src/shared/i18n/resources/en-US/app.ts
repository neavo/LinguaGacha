import { zh_cn_app } from "../zh-CN/app";
import { LANGUAGE_DISPLAY_NAMES } from "../../../language";
import type { LocaleMessageSchema } from "../../types";

export const en_us_app = {
  aria: {
    toggle_navigation: "Toggle navigation",
  },
  metadata: {
    app_name: "LinguaGacha",
  },
  action: {
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
    reset: "Reset",
    skip: "Skip",
    overwrite: "Overwrite",
    replace: "Replace",
    loading: "Loading",
    select_file: "Select File",
    select_folder: "Select Folder",
  },
  feedback: {
    save_success: "Saved …",
    no_valid_data: "No valid data …",
    update_failed: "Update failed …",
    project_settings_aligned: "Project settings updated from current settings …",
  },
  error_boundary: {
    eyebrow: "Renderer Runtime",
    title: "Page runtime error",
    description:
      "This window switched to the protected view, and the error details were written to logs.",
  },
  project_settings_alignment: {
    field: {
      source_language: "Source language",
      target_language: "Target language",
      mtool_optimizer_enable: "MTool optimizer",
      skip_duplicate_source_text_enable: "Skip duplicate source text",
    },
  },
  close_confirm: {
    description: "Confirm exiting the app …?",
  },
  quality_rule_import: {
    duplicate_description: "{COUNT} duplicate rules were detected. Choose how to handle them …?",
  },
  update: {
    toast: "New version is available, click the bottom-left update entry to download it …",
  },
  system_proxy: {
    startup_notice: "System proxy setting detected - {PROXY}",
  },
  drop: {
    multiple_unavailable: "Only one file can be dropped at a time",
    unavailable:
      "The local path of the dropped file is unavailable right now. Please use the import picker instead.",
    import_here: "Release to import the rule file",
  },
  toggle: {
    disabled: "OFF",
    enabled: "ON",
  },
  drag: {
    enabled: "Drag to reorder",
    disabled: "Drag disabled",
  },
  language: Object.fromEntries(
    Object.entries(LANGUAGE_DISPLAY_NAMES).map(([code, names]) => [code, names.en]),
  ) as Record<keyof typeof LANGUAGE_DISPLAY_NAMES, string>,
  navigation_action: {
    theme: "Theme",
    switch_theme: "Switch Theme",
    toggle_lg_base_font: "Switch Font",
    language: "Language",
    logs: "Logs",
  },
  profile: {
    status: "Ciallo～(∠・ω< )⌒✮",
    status_tooltip: "Open the GitHub repository",
    update_available: "Download new version …!",
    update_available_tooltip: "Open the GitHub Release page",
  },
  prompt: {
    builder_control_character_samples: "Control Characters Samples:",
    builder_glossary_header: "Glossary <Original Term> -> <Translated Term> #<Term Information>:",
    builder_input: "Input:",
    builder_preceding_context: "Preceding Context:",
  },
  native_file_filter: {
    project: "LinguaGacha Project",
    supported_json_xlsx_files: "Supported files (*.json *.xlsx)",
    json_files: "JSON files (*.json)",
    excel_files: "Excel files (*.xlsx)",
    supported_txt_files: "Supported files (*.txt)",
  },
  error: {
    request: {
      validation_failed: {
        message: "The request parameters are invalid …",
      },
      invalid_json: {
        message: "The request JSON is invalid …",
      },
      route_not_found: {
        message: "The API route does not exist …",
      },
    },
    project: {
      not_loaded: {
        message: "No project is loaded …",
        action: "Open or create a project first …",
      },
      not_found: {
        message: "The project file does not exist …",
        action: "Make sure the project file is still in its original location …",
      },
    },
    file: {
      not_found: {
        message: "The file does not exist …",
        action: "Make sure the file is still in its original location …",
      },
      unsupported_format: {
        message: "This file format is not supported …",
        action: "Choose a source file supported by LinguaGacha …",
      },
      parse_failed: {
        message: "File content parsing failed …",
        action: "Make sure the file is complete, or import an undamaged original file …",
      },
      invalid_structure: {
        message: "The file structure does not match the expected format …",
        action: "Make sure the file came from the expected source, or export it again …",
      },
      io_failed: {
        message: "File read or write failed …",
      },
    },
    database: {
      conflict: {
        message: "Database write conflict. Please refresh and try again …",
        action: "Refresh the current data and submit again …",
      },
    },
    data: {
      revision_conflict: {
        message: "The data version changed. Please refresh and try again …",
        action: "Refresh the current data and submit again …",
      },
    },
    task: {
      busy: {
        message: "A background task is running. Please try again later …",
        action: "Wait for the current task to finish or stop it first …",
      },
    },
    model: {
      not_found: {
        message: "The model configuration does not exist …",
        action: "Select a model configuration again …",
      },
      provider_failed: {
        message: "The model service request failed. Please check the API settings …",
        action: "Check the model URL, API key, and provider status …",
      },
    },
    worker: {
      failed: {
        message: "The background execution channel failed …",
      },
      execution_failed: {
        message: "The background task failed …",
      },
    },
    runtime: {
      capability_missing: {
        message: "The current runtime is missing a required capability …",
      },
      disposed: {
        message: "The runtime resource has been disposed …",
      },
      cancelled: {
        message: "The operation was cancelled …",
      },
      internal_invariant: {
        message: "Internal state error …",
      },
    },
    language: {
      invalid_target_language: {
        message: "The target language is invalid …",
      },
      unsupported_all_target_language: {
        message: "The target language cannot be All …",
      },
      unknown_source_language_code: {
        message: "The source language code is invalid …",
      },
    },
    quality: {
      unknown_rule_type: {
        message: "The quality rule type is invalid …",
      },
      unsupported_rule_meta: {
        message: "The quality rule setting is invalid …",
      },
    },
    prompt: {
      unknown_prompt_type: {
        message: "The prompt type is invalid …",
      },
    },
    desktop: {
      missing_core_api_base_url: {
        message: "Core API URL is not configured …",
      },
      core_api_unavailable: {
        message: "Core API is unavailable …",
      },
      core_metadata_unavailable: {
        message: "Core metadata is unavailable …",
      },
      event_stream_failed: {
        message: "Event stream connection failed …",
      },
      http_error: {
        message: "Request failed: {PATH} …",
      },
      network_failed: {
        message: "Network request failed: {PATH} …",
      },
      timeout: {
        message: "Request timed out: {PATH} …",
      },
    },
  },
  diagnostic: {
    api_gateway: {
      direct_route_failed: "API Gateway direct route handling failed …",
    },
    default_preset: {
      config_normalize_failed: "Failed to normalize default preset configuration: {CONFIG_PATH} …",
      prompt_load_failed: "Failed to load default prompt preset …",
      quality_rule_load_failed: "Failed to load default quality rule preset …",
      value_normalize_failed:
        "Failed to normalize default preset value: {PRESET_DIRECTORY} -> {VALUE} …",
    },
    file_export: {
      open_output_folder_failed: "Failed to open the output folder …",
      translation_failed: "Failed to generate translation files …",
      write_file_failed: "File writing failed …",
    },
    lifecycle: {
      app_start_failed: "LinguaGacha failed to start …",
      core_gateway_start_failed: "Core / Gateway startup failed …",
      main_fatal_uncaught: "Electron main caught an unhandled fatal exception …",
    },
    migration: {
      path_failed: "Failed to migrate path: {SOURCE_PATH} -> {DESTINATION_PATH} …",
    },
    renderer: {
      main_frame_load_failed: "Renderer main frame failed to load …",
      process_exited: "Renderer process exited …",
      reported_error: "Renderer captured a frontend runtime error …",
      subframe_load_failed: "Renderer subframe failed to load …",
      window_unresponsive: "Window became unresponsive …",
    },
  },
  log: {
    analysis_task_no_terms: "No terms extracted",
    analysis_task_result: "Analysis Result:",
    analysis_task_source_texts: "Analysis Input:",
    api_gateway_started: "API Gateway started - {BASE_URL}",
    api_test_fail: "API test failed …",
    api_test_key: "Testing Key:",
    api_test_messages: "Task Prompts:",
    api_test_result: "Tested {COUNT} APIs in total, {SUCCESS} successful, {FAILURE} failed …",
    api_test_result_failure: "Failed Keys:",
    api_test_response_result: "Model Response:",
    api_test_timeout: "Request timed out ({SECONDS}s)",
    api_test_token_info: "Task time {TIME} seconds, input tokens {PT}, output tokens {CT}",
    app_version: "LinguaGacha v{VERSION} …",
    system_proxy_startup_detected: "System proxy setting detected - {PROXY}",
    default_preset_loaded: "Default presets loaded automatically: {NAMES} …",
    engine_api_model: "API Model",
    engine_api_name: "API Name",
    engine_api_url: "API URL",
    engine_task_done: "Task completed …",
    engine_task_exception: "Task failed …",
    engine_task_fail:
      "Task failed to complete, some data remains unprocessed. Please check the results …",
    engine_task_rule_analysis: "Rule Analysis:",
    engine_task_thinking_process: "Thinking Process:",
    engine_task_stop: "Task stopped …",
    engine_task_success:
      "Task time {TIME} seconds, {LINES} lines of text, input tokens {PT}, output tokens {CT}",
    generate_translation_done: "Translation files saved to {PATH} …",
    generate_translation_start: "Generating translation files …",
    response_checker_fail_data: "Data Structure Error",
    response_checker_fail_degradation: "Degradation Occurred",
    response_checker_fail_line_count: "Line Count Mismatch",
    response_checker_fail_request: "Model Request Failed",
    response_checker_fail_timeout: "Network Request Timeout",
    response_checker_line_error_empty_line: "Empty Line",
    response_checker_line_error_hangeul: "Hangeul Residue",
    response_checker_line_error_kana: "Kana Residue",
    response_checker_line_error_similarity: "High Similarity",
    system_closed_dropped: "Log system is shut down; dropping new log: {MESSAGE}",
    translation_response_check_fail: "Data error, will automatically retry, Reason: {REASON}",
    translation_response_check_fail_all:
      "All translated text quality check failed, will automatically split and retry, Reason: {REASON}",
    translation_response_check_fail_part:
      "Partial translated text quality check failed, will automatically split and retry, Reason: {REASON}",
    translation_task_result: "Translation Result:",
    translation_task_status_info:
      "Split: {SPLIT} | Retry: {RETRY} | Task Length Threshold: {THRESHOLD}",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_app>;

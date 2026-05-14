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
    retry: "Retry",
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
  update: {
    toast: "New version is available, click the bottom-left update entry to download it …",
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
  error: {
    validation_failed: "The request parameters are invalid …",
    route_not_found: "The API route does not exist …",
    project_not_loaded: "No project is loaded …",
    project_not_found: "The project file does not exist …",
    file_not_found: "The file does not exist …",
    revision_conflict: "The data version changed. Please refresh and try again …",
    task_busy: "A background task is running. Please try again later …",
    unsupported_file_format: "This file format is not supported …",
    file_io_failed: "File read or write failed …",
    database_conflict: "Database write conflict. Please refresh and try again …",
    model_not_found: "The model configuration does not exist …",
    model_provider_failed: "The model service request failed. Please check the API settings …",
    worker_failed: "The background execution channel failed …",
    runtime_capability_missing: "The current runtime is missing a required capability …",
    internal_invariant: "Internal state error …",
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
      translation_failed: "Failed to generate translation files …",
      write_file_failed: "File writing failed …",
    },
    lifecycle: {
      app_start_failed: "LinguaGacha failed to start …",
      core_gateway_start_failed: "Core / Gateway startup failed - {ERROR} …",
    },
    migration: {
      path_failed: "Failed to migrate path: {SOURCE_PATH} -> {DESTINATION_PATH} …",
    },
    renderer: {
      main_frame_load_failed: "Renderer main frame failed to load …",
      process_exited: "Renderer process exited …",
      subframe_load_failed: "Renderer subframe failed to load …",
      window_unresponsive: "Window became unresponsive …",
    },
  },
  log: {
    analysis_task_extracted_terms: "Extracted Terms:",
    analysis_task_no_terms: "No terms extracted",
    analysis_task_source_texts: "Analysis Input:",
    api_gateway_started: "API Gateway started - {BASE_URL}",
    api_test_fail: "API test failed …\nReason: {REASON}",
    api_test_key: "Testing Key:",
    api_test_messages: "Task Prompts:",
    api_test_result: "Tested {COUNT} APIs in total, {SUCCESS} successful, {FAILURE} failed …",
    api_test_result_failure: "Failed Keys:",
    api_test_timeout: "Request timed out ({SECONDS}s)",
    api_test_token_info: "Task time {TIME} seconds, input tokens {PT}, output tokens {CT}",
    app_version: "LinguaGacha v{VERSION} …",
    default_preset_loaded: "Default presets loaded automatically: {NAMES} …",
    engine_api_model: "API Model",
    engine_api_name: "API Name",
    engine_api_url: "API URL",
    engine_task_done: "Task completed …",
    engine_task_exception: "Task failed …",
    engine_task_fail:
      "Task failed to complete, some data remains unprocessed. Please check the results …",
    engine_task_response_result: "Model Response:",
    engine_task_response_think: "Model Thinking:",
    engine_task_stop: "Task stopped …",
    engine_task_success:
      "Task time {TIME} seconds, {LINES} lines of text, input tokens {PT}, output tokens {CT}",
    export_translation_done: "Translation files saved to {PATH} …",
    export_translation_start: "Generating translation …",
    export_translation_success: "Translation files generated …",
    response_checker_fail_data: "Data Structure Error",
    response_checker_fail_degradation: "Degradation Occurred",
    response_checker_fail_line_count: "Line Count Mismatch",
    response_checker_fail_timeout: "Network Request Timeout",
    response_checker_line_error_empty_line: "Empty Line",
    response_checker_line_error_hangeul: "Hangeul Residue",
    response_checker_line_error_kana: "Kana Residue",
    response_checker_line_error_similarity: "High Similarity",
    system_closed_dropped: "Log system is shut down; dropping new log: {MESSAGE}",
    translation_response_check_fail: "Data error, will automatically retry, Reason: {REASON}",
    translation_response_check_fail_all:
      "All translated text quality check failed, will automatically split and retry, Reason: {REASON}",
    translation_response_check_fail_force: "Translation check failed",
    translation_response_check_fail_part:
      "Partial translated text quality check failed, will automatically split and retry, Reason: {REASON}",
    translation_task_force_accept_info: " | Forced Accept: {REASON}",
    translation_task_status_info:
      "Split: {SPLIT} | Retry: {RETRY} | Task Length Threshold: {THRESHOLD}",
    translation_unknown_reason: "Unknown Reason",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_app>;

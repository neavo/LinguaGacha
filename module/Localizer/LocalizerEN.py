from module.Localizer.LocalizerZH import LocalizerZH


class LocalizerEN(LocalizerZH):
    # 通用
    api_url: str = "API URL"
    issue_kana_residue: str = "Kana Residue"
    issue_hangeul_residue: str = "Hangeul Residue"
    task_failed: str = "Task failed …"
    task_success: str = "Task succeeded …"
    task_running: str = "Task is running …"
    task_processing: str = "Processing …"
    export_translation_start: str = "Generating translation …"
    export_translation_done: str = "Translation files saved to [blue]{PATH}[/blue] …"
    export_translation_success: str = "Translation files generated …"
    export_translation_failed: str = "Failed to generate translation files …"
    alert_project_not_loaded: str = "Please load a project first …"
    alert_no_active_model: str = "No active model configuration found …"

    # 主页面
    app_exit_countdown: str = "Exiting … {SECONDS} …"
    app_new_version_found: str = "New version found, version: {VERSION}. Please click the button on the bottom left to download and update …"
    app_new_version_failure: str = "New version download failed …"
    app_new_version_success: str = "New version download successful …"
    app_new_version_apply_failed: str = "Update failed and rolled back …"
    app_new_version_waiting_restart: str = "Update completed, application will close soon …"
    app_glossary_page: str = "Glossary"
    app_text_preserve_page: str = "Text Preserve"
    app_pre_translation_replacement_page: str = "Pre-Translation"
    app_post_translation_replacement_page: str = "Post-Translation"
    app_analysis_prompt_page: str = "Analysis Prompts"
    app_translation_prompt_page: str = "Translation Prompts"

    # 路径
    path_translated: str = "Translated"
    path_translated_bilingual: str = "Translated_Bilingual"

    # 日志
    log_crash: str = "A critical error has occurred, app will now exit, error detail has been saved to the log file …"
    log_api_test_fail: str = (
        "API test failed …"
        "\n"
        "Reason: {REASON}"
    )
    log_read_file_fail: str = "File reading failed …"
    log_write_file_fail: str = "File writing failed …"
    log_unknown_reason: str = "Unknown Reason"
    log_cli_verify_language: str = "parameter error: invalid language …"
    log_cli_target_language_all_unsupported: str = "ALL is not supported …"
    log_cli_create_deprecated: str = "CLI argument --create is deprecated, project creation is now decided only by --input …"
    log_cli_continue_deprecated: str = "CLI argument --continue is deprecated, task mode is now inferred automatically from current progress …"
    log_cli_quality_rule_file_not_found: str = (
        "parameter error: rule file not found …"
        "\n"
        "Argument: {ARG}"
        "\n"
        "Path: {PATH}"
    )
    log_cli_quality_rule_file_unsupported: str = (
        "parameter error: unsupported rule file format (only .json/.xlsx) …"
        "\n"
        "Argument: {ARG}"
        "\n"
        "Path: {PATH}"
    )
    log_cli_quality_rule_import_failed: str = (
        "quality rule import failed …"
        "\n"
        "Argument: {ARG}"
        "\n"
        "Path: {PATH}"
        "\n"
        "Reason: {REASON}"
    )
    log_cli_text_preserve_mode_invalid: str = (
        "parameter error: invalid text preserve options …"
        "\n"
        "--text_preserve_mode: {MODE}"
        "\n"
        "--text_preserve: {PATH}"
        "\n"
        "Note: mode=custom requires --text_preserve; providing --text_preserve requires mode=custom"
    )
    log_cli_analysis_export_start: str = "Exporting glossary files …"
    log_cli_analysis_export_success: str = (
        "Glossary export completed …"
        "\n"
        "Directory: {DIR}"
        "\n"
        "JSON: {JSON}"
        "\n"
        "XLSX: {XLSX}"
        "\n"
        "Glossary Entries: {COUNT}"
        "\n"
        "Imported This Run: {IMPORTED}"
    )
    log_cli_analysis_export_failed: str = "Glossary export failed …"

    # 引擎
    engine_no_items: str = "No items to process were found, please check …"
    engine_task_done: str = "Task completed …"
    engine_task_fail: str = "Task failed to complete, some data remains unprocessed. Please check the results …"
    engine_task_stop: str = "Task stopped …"
    engine_task_rule_filter: str = "Rule filtering completed, {COUNT} entries that do not require translation were filtered in total …"
    engine_task_language_filter: str = "Language filtering completed, {COUNT} non-target source language entries were skipped in total …"
    engine_task_simple_log_prefix: str = "Simple Log"
    engine_task_success: str = "Task time {TIME} seconds, {LINES} lines of text, input tokens {PT}, output tokens {CT}"
    engine_task_response_think: str = "Model Thinking:"
    engine_task_response_result: str = "Model Response:"
    translation_task_status_info: str = "Split: {SPLIT} | Retry: {RETRY} | Task Length Threshold: {THRESHOLD}"
    translation_task_force_accept_info: str = " | Forced Accept: {REASON}"
    engine_api_name: str = "API Name"
    engine_api_model: str = "API Model"
    api_test_timeout: str = "Request timed out ({SECONDS}s)"
    api_test_result: str = "Tested {COUNT} APIs in total, {SUCCESS} successful, {FAILURE} failed …"
    translation_mtool_optimizer_pre_log: str = "MToolOptimizer pre-processing completed, {COUNT} entries containing duplicate clauses were filtered in total …"
    translation_mtool_optimizer_post_log: str = "MToolOptimizer post-processing completed …"
    translation_response_check_fail: str = "Data error, will automatically retry, Reason: {REASON}"
    translation_response_check_fail_all: str = "All translated text quality check failed, will automatically split and retry, Reason: {REASON}"
    translation_response_check_fail_part: str = "Partial translated text quality check failed, will automatically split and retry, Reason: {REASON}"
    translation_response_check_fail_force: str = "Translation check failed"
    response_checker_fail_data: str = "Data Structure Error"
    response_checker_fail_timeout: str = "Network Request Timeout"
    response_checker_fail_line_count: str = "Line Count Mismatch"
    response_checker_fail_degradation: str = "Degradation Occurred"
    response_checker_line_error_empty_line: str = "Empty Line"
    response_checker_line_error_similarity: str = "High Similarity"
    project_store_ingesting_assets: str = "Ingesting assets …"
    project_store_ingesting_file: str = "Ingesting assets: {NAME}"
    project_store_parsing_items: str = "Parsing translation items …"
    project_store_created: str = "Project creation completed …"
    project_store_file_not_found: str = "Project file not found: {PATH}"

    # 翻译
    translation_resetting: str = "Resetting …"

    # 分析
    analysis_page_import_success: str = "Import succeeded, added {COUNT} entries …"
    analysis_task_source_texts: str = "Analysis Input:"
    analysis_task_extracted_terms: str = "Extracted Terms:"
    analysis_task_no_terms: str = "No terms extracted"

    # 校对
    proofreading_page_status_none: str = "Untranslated"
    proofreading_page_status_processed: str = "Translation Completed"
    proofreading_page_status_error: str = "Translation Failed"

    # 工作台
    workbench_msg_file_exists: str = "File already exists …"
    workbench_msg_unsupported_format: str = "Unsupported file format"
    workbench_msg_replace_format_mismatch: str = "File format mismatch, cannot replace"
    workbench_msg_replace_name_conflict: str = "File already exists …"
    workbench_progress_adding_file: str = "Adding file …"
    workbench_progress_resetting_file: str = "Resetting file …"
    workbench_progress_deleting_file: str = "Deleting file …"
    workbench_msg_file_not_found: str = "File not found"

    # 质量类通用
    quality_default_preset_loaded_message: str = "Default preset loaded: {NAME} …"

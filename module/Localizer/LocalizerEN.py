from module.Localizer.LocalizerZH import LocalizerZH


class LocalizerEN(LocalizerZH):
    # 通用
    api_url: str = "API URL"
    issue_kana_residue: str = "Kana Residue"
    issue_hangeul_residue: str = "Hangeul Residue"
    task_failed: str = "Task failed …"
    task_running: str = "Task is running …"
    task_processing: str = "Processing …"
    export_translation_start: str = "Generating translation …"
    export_translation_done: str = "Translation files saved to {PATH} …"
    export_translation_success: str = "Translation files generated …"
    export_translation_failed: str = "Failed to generate translation files …"
    alert_project_not_loaded: str = "Please load a project first …"
    alert_no_active_model: str = "No active model configuration found …"
    alert_no_data: str = "No valid data …"
    alert_invalid_export_data: str = "Invalid export data …"

    # 主页面
    app_exit_countdown: str = "Exiting … {SECONDS} …"
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

    # 引擎
    engine_no_items: str = "No items to process were found, please check …"
    engine_task_done: str = "Task completed …"
    engine_task_fail: str = "Task failed to complete, some data remains unprocessed. Please check the results …"
    engine_task_stop: str = "Task stopped …"
    engine_task_rule_filter: str = "Rule filtering completed, {COUNT} entries that do not require translation were filtered in total …"
    engine_task_language_filter: str = "Language filtering completed, {COUNT} non-target source language entries were skipped in total …"
    engine_task_success: str = "Task time {TIME} seconds, {LINES} lines of text, input tokens {PT}, output tokens {CT}"
    engine_task_response_think: str = "Model Thinking:"
    engine_task_response_result: str = "Model Response:"
    translation_task_status_info: str = "Split: {SPLIT} | Retry: {RETRY} | Task Length Threshold: {THRESHOLD}"
    translation_task_force_accept_info: str = " | Forced Accept: {REASON}"
    engine_api_name: str = "API Name"
    engine_api_model: str = "API Model"
    api_test_key: str = "Testing Key:"
    api_test_messages: str = "Task Prompts:"
    api_test_timeout: str = "Request timed out ({SECONDS}s)"
    api_test_result: str = "Tested {COUNT} APIs in total, {SUCCESS} successful, {FAILURE} failed …"
    api_test_result_failure: str = "Failed Keys:"
    api_test_token_info: str = "Token usage: input {INPUT}, output {OUTPUT}, time {TIME}s"
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

    # 分析
    analysis_task_source_texts: str = "Analysis Input:"
    analysis_task_extracted_terms: str = "Extracted Terms:"
    analysis_task_no_terms: str = "No terms extracted"

    # 工作台
    workbench_msg_file_exists: str = "File already exists …"
    workbench_msg_unsupported_format: str = "Unsupported file format"
    workbench_msg_replace_name_conflict: str = "File already exists …"
    workbench_msg_file_not_found: str = "File not found"

    # 质量类通用
    quality_default_preset_loaded_message: str = "Default preset loaded: {NAME} …"

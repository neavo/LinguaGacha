from module.Localizer.LocalizerZH import LocalizerZH

class LocalizerEN(LocalizerZH):

    # 保留
    switch_language: str = (
        "请选择应用语言，新的语言设置将在下次启动时生效 …"
        "\n"
        "Select application language, changes will take effect on restart …"
    )
    switch_language_toast: str = (
        "应用语言切换成功，请重启应用生效 …"
        "\n"
        "Language switched successfully, please restart the application for changes to take effect …"
    )

    # 通用
    add: str = "Add"
    edit: str = "Edit"
    none: str = "None"
    back: str = "Back"
    next: str = "Next"
    stop: str = "Stop"
    start: str = "Start"
    timer: str = "Timer"
    close: str = "Close"
    alert: str = "Alert"
    warning: str = "Warning"
    confirm: str = "Confirm"
    cancel: str = "Cancel"
    auto: str = "Auto"
    wiki: str = "Wiki"
    open: str = "Open"
    select: str = "Select"
    inject: str = "Inject"
    filter: str = "Filter"
    search: str = "Search"
    generate: str = "Generate"
    placeholder: str = "Please enter keywords …"
    task_success: str = "Task succeeded …"
    alert_no_data: str = "No valid data …"
    alert_reset_timer: str = "Confirm to reset timer?"
    alert_reset_translation: str = "Confirm to reset translation task and start a new task?"

    # 主页面
    app_close_message_box: str = "Are you sure you want to exit the application … ?"
    app_new_version: str = "Download New Version!"
    app_new_version_toast: str = "New version found, version: {VERSION}. Please click the button on the bottom left to download and update …"
    app_new_version_update: str = "Downloading {PERCENT} …"
    app_new_version_failure: str = "New version download failed …"
    app_new_version_success: str = "New version download successful …"
    app_new_version_downloaded: str = "Click to apply New Version!"
    app_new_version_waiting_restart: str = "Update completed, application will close soon …"
    app_theme_btn: str = "Theme"
    app_language_btn: str = "Language"
    app_settings_page: str = "App Settings"
    app_platform_page: str = "API"
    app_project_page: str = "Project Settings"
    app_task_page: str = "Start Task"
    app_basic_settings_page: str = "Basic Settings"
    app_expert_settings_page: str = "Expert Settings"
    app_glossary_page: str = "Glossary"
    app_text_preserve_page: str = "Text Preserve"
    app_text_replacement_page: str = "Text Replacement"
    app_pre_translation_replacement_page: str = "Pre-Translation"
    app_post_translation_replacement_page: str = "Post-Translation"
    app_custom_prompt_navigation_item: str = "Custom Prompts"
    app_custom_prompt_zh_page: str = "Chinese Prompts"
    app_custom_prompt_en_page: str = "English Prompts"
    app_laboratory_page: str = "Laboratory"
    app_treasure_chest_page: str = "Treasure Chest"

    # 路径
    path_bilingual: str = "bilingual"
    path_result_check_kana: str = "result_check_residual_kana.json"
    path_result_check_hangeul: str = "result_check_residual_hangeul.json"
    path_result_check_text_preserve: str = "result_check_text_preserve.json"
    path_result_check_similarity: str = "result_check_high_similarity.json"
    path_result_check_glossary: str = "result_check_incorrect_glossary.json"
    path_result_check_untranslated: str = "result_check_untranslated_entries.json"
    path_result_check_retry_count_threshold: str = "result_check_retry_count_reach_threshold.json"
    path_result_batch_correction: str = "batch_correction.xlsx"
    path_result_name_field_extraction: str = "name_field_extraction.xlsx"

    # 日志
    log_crash: str = "A critical error has occurred, app will now exit, error detail has been saved to the log file …"
    log_proxy: str = "Network proxy enabled …"
    log_expert_mode: str = "Expert Mode Enabled …"
    log_api_test_fail: str = "API test failed … "
    log_task_fail: str = "Task failed …"
    log_read_file_fail: str = "File reading failed …"
    log_write_file_fail: str = "File writing failed …"
    cli_verify_folder: str = "parameter error: invalid path …"
    cli_verify_language: str = "parameter error: invalid language …"

    # 引擎
    engine_no_items: str = "No items to process were found, please check …"
    engine_task_running: str = "Task is running, please try again later …"
    engine_task_done: str = "All data has been processed, task finished …"
    engine_task_fail: str = "Reached the maximum task rounds, but some data remains unprocessed. Please check the results …"
    engine_task_stop: str = "Task stopped …"
    engine_task_save: str = "Generating output file, please wait …"
    engine_task_save_done: str = "Task results have been saved to the {PATH} directory …"
    engine_task_generation: str = "Task generation completed, {COUNT} tasks generated in total …"
    engine_task_rule_filter: str = "Rule filtering completed, {COUNT} entries that do not require translation were filtered in total …"
    engine_task_language_filter: str = "Language filtering completed, {COUNT} entries not containing the target language were filtered in total …"
    engine_max_round: str = "Max Rounds"
    engine_current_round: str = "Current Round"
    engine_api_url: str = "API URL"
    engine_api_name: str = "API Name"
    engine_api_model: str = "API Model"
    engine_response_think: str = "Model Thinking:"
    engine_response_result: str = "Model Response:"
    engine_task_success: str = "Task time {TIME} seconds, {LINES} lines of text, input tokens {PT}, output tokens {CT}"
    engine_task_too_many: str = "Too many real-time tasks, details hidden for performance …"
    api_tester_key: str = "Testing Key:"
    api_tester_messages: str = "Task Prompts:"
    api_tester_result: str = "Tested {COUNT} APIs in total, {SUCCESS} successful, {FAILURE} failed …"
    api_tester_result_failure: str = "Failed Keys:"
    api_tester_running: str = "Task is running, please try again later …"
    translator_mtool_optimizer_pre_log: str = "MToolOptimizer pre-processing completed, {COUNT} entries containing duplicate clauses were filtered in total …"
    translator_mtool_optimizer_post_log: str = "MToolOptimizer post-processing completed …"
    translator_response_check_fail: str = "Translated text failed check, will automatically retry in the next round of translation"
    translator_response_check_fail_all: str = "All translated text failed check, will automatically retry in the next round of translation"
    translator_response_check_fail_part: str = "Partial translated text failed check, will automatically retry in the next round of translation"
    file_checker_kana: str = "Kana residue check complete, no issues found …"
    file_checker_kana_full: str = "Kana residue check complete, {COUNT} issues found, {PERCENT}%, results written to [green]{TARGET}[/] …"
    file_checker_hangeul: str = "Hangeul residue check complete, no issues found …"
    file_checker_hangeul_full: str = "Hangeul residue check complete, {COUNT} issues found, {PERCENT}%, results written to [green]{TARGET}[/] …"
    file_checker_text_preserve: str = "Text preservation check completed, no issues found …."
    file_checker_text_preserve_full: str = "Text preservation check completed, found {COUNT} potential issues ({PERCENT}%), results written to [green]{TARGET}[/] …."
    file_checker_text_preserve_alert_key: str = "____ALERT____"
    file_checker_text_preserve_alert_value: str = "This file lists entries where text preservation **might** not have worked correctly. Please verify in context!!"
    file_checker_similarity: str = "Similarity check complete, no issues found …"
    file_checker_similarity_full: str = "Similarity check complete, {COUNT} potential issues found, {PERCENT}%, results written to [green]{TARGET}[/] …"
    file_checker_similarity_alert_key: str = "____ALERT____"
    file_checker_similarity_alert_value: str = "This file lists entries with *potentially* high similarity. Please verify in context!"
    file_checker_glossary: str = "Glossary check complete, no issues found …"
    file_checker_glossary_full: str = "Glossary check complete, {COUNT} issues found, {PERCENT}%, results written to [green]{TARGET}[/] …"
    response_checker_fail_data: str = "Data Structure Error"
    response_checker_fail_line_count: str = "Line Count Mismatch"
    response_checker_line_error_kana: str = "Kana Residue"
    response_checker_line_error_hangeul: str = "Hangeul Residue"
    response_checker_line_error_empty_line: str = "Empty Line"
    response_checker_line_error_similarity: str = "High Similarity"
    response_checker_line_error_degradation: str = "Degradation Occurred"
    response_decoder_glossary_by_json: str = "Glossary data -> deserialization, total {COUNT} entries"
    response_decoder_glossary_by_rule: str = "Glossary data -> rule parsing after split, total {COUNT} entries"
    response_decoder_translation_by_json: str = "Translation data -> deserialization, total {COUNT} entries"
    response_decoder_translation_by_rule: str = "Translation data -> rule parsing after split, total {COUNT} entries"

    # 应用设置
    app_settings_page_expert_title: str = "Expert Mode"
    app_settings_page_expert_content: str = "Enabling this feature will display more log information and provide more advanced setting options (takes effect after app restart)"
    app_settings_page_font_hinting_title: str = "Font Hinting"
    app_settings_page_font_hinting_content: str = "Enabling this feature will render the edges of UI fonts more smoothly (takes effect after app restart)"
    app_settings_page_scale_factor_title: str = "Global Scale Factor"
    app_settings_page_scale_factor_content: str = "Enabling this feature will scale the app interface according to the selected ratio (takes effect after app restart)"
    app_settings_page_proxy_url: str = "Example - http://127.0.0.1:7890"
    app_settings_page_proxy_url_title: str = "Network Proxy"
    app_settings_page_proxy_url_content: str = "Enabling this feature will use the set proxy address to send network requests  (takes effect after app restart)"
    app_settings_page_close: str = "The application will close, please confirm …"

    # 接口管理
    platform_page_api_test_result: str = "API test result: {SUCCESS} successful, {FAILURE} failed …"
    platform_page_api_activate: str = "Activate API"
    platform_page_api_edit: str = "Edit API"
    platform_page_api_args: str = "Edit Arguments"
    platform_page_api_test: str = "Test API"
    platform_page_api_delete: str = "Delete API"
    platform_page_widget_add_title: str = "API List"
    platform_page_widget_add_content: str = "Add and manage any LLM API compatible with Google, OpenAI and Anthropic formats here"

    # 接口编辑
    platform_edit_page_name: str = "Please enter API name …"
    platform_edit_page_name_title: str = "API Name"
    platform_edit_page_name_content: str = "Please enter API name, only for display within the app, no practical effect"
    platform_edit_page_api_url: str = "Please enter API URL …"
    platform_edit_page_api_url_title: str = "API URL"
    platform_edit_page_api_url_content: str = "Please enter API URL, pay attention to whether /v1 needs to be added at the end"
    platform_edit_page_api_key: str = "Please enter API Key …"
    platform_edit_page_api_key_title: str = "API Key"
    platform_edit_page_api_key_content: str = "Please enter API Key, e.g., sk-d0daba12345678fd8eb7b8d31c123456. Multiple keys can be entered for polling, one key per line"
    platform_edit_page_thinking_title: str = "Thinking Mode Priority"
    platform_edit_page_thinking_content: str = "For models that support both thinking and normal modes, prioritize using thinking mode [→ Click to view the list of supported models ←](https://github.com/neavo/LinguaGacha/wiki/ModelsForThinkingModePriorityEN)"
    platform_edit_page_model: str = "Please enter Model Name …"
    platform_edit_page_model_title: str = "Model Name"
    platform_edit_page_model_content: str = "Current model in use: {MODEL}"
    platform_edit_page_model_edit: str = "Manual Input"
    platform_edit_page_model_sync: str = "Fetch Online"

    # 参数编辑
    args_edit_page_top_p_title: str = "top_p"
    args_edit_page_top_p_content: str = "Please set with caution, incorrect values may cause abnormal results or request errors"
    args_edit_page_temperature_title: str = "temperature"
    args_edit_page_temperature_content: str = "Please set with caution, incorrect values may cause abnormal results or request errors"
    args_edit_page_presence_penalty_title: str = "presence_penalty"
    args_edit_page_presence_penalty_content: str = "Please set with caution, incorrect values may cause abnormal results or request errors"
    args_edit_page_frequency_penalty_title: str = "frequency_penalty"
    args_edit_page_frequency_penalty_content: str = "Please set with caution, incorrect values may cause abnormal results or request errors"
    args_edit_page_document_link: str = "Click to view documentation"

    # 模型列表
    model_list_page_title: str = "Available Model List"
    model_list_page_content: str = "Click to select the model to use"
    model_list_page_fail: str = "Failed to get model list, please check API configuration …"

    # 项目设置
    project_page_source_language_title: str = "Source Language"
    project_page_source_language_content: str = "Set the language of the input text in the current project"
    project_page_target_language_title: str = "Target Language"
    project_page_target_language_content: str = "Set the language of the output text in the current project"
    project_page_input_folder_title: str = "Input Folder"
    project_page_input_folder_content: str = "The current input folder is"
    project_page_output_folder_title: str = "Output Folder (Can not be same as input folder)"
    project_page_output_folder_content: str = "The current output folder is"
    project_page_output_folder_open_on_finish_title: str = "Open Output Folder on Task Completion"
    project_page_output_folder_open_on_finish_content: str = "When enabled, the output folder will be automatically opened upon task completion"
    project_page_traditional_chinese_title: str = "Output Chinese in Traditional Characters"
    project_page_traditional_chinese_content: str = "When enabled, Chinese text will be output in Traditional characters if the target language is set to Chinese"

    # 开始翻译
    task_page_status_idle: str = "Idle"
    task_page_status_testing: str = "Testing"
    task_page_status_translating: str = "Translating"
    task_page_status_stopping: str = "Stopping"
    task_page_indeterminate_saving: str = "Saving cache …"
    task_page_indeterminate_stoping: str = "Stopping task …"
    task_page_card_time: str = "Elapsed Time"
    task_page_card_remaining_time: str = "Remaining Time"
    task_page_card_line: str = "Processed Lines"
    task_page_card_remaining_line: str = "Remaining Lines"
    task_page_card_speed: str = "Average Speed"
    task_page_card_token: str = "Total Tokens"
    task_page_card_task: str = "Real Time Tasks"
    task_page_alert_pause: str = "Stopped tasks can be resumed at any time. Confirm to stop the task … ?"
    task_page_continue: str = "Continue Task"
    task_page_export: str = "Export Task Data"
    task_page_timer: str = "Waiting time before delayed startup"

    # 基础设置
    basic_settings_page_max_workers_title: str = "Concurrent Task Threshold"
    basic_settings_page_max_workers_content: str = (
        "Maximum number of tasks executing simultaneously"
        "<br>"
        "Proper configuration can significantly speed up task completion"
        "<br>"
        "Please refer to the API platform's documentation for settings, 0 = Automatic"
    )
    basic_settings_page_rpm_threshold_title: str = "Requests Per Minute Threshold"
    basic_settings_page_rpm_threshold_content: str = (
        "Maximum total number of tasks executed per minute, i.e., the <font color='darkgoldenrod'><b>RPM</b></font> threshold"
        "<br>"
        "Some platforms may limit the request rate"
        "<br>"
        "Please refer to the API platform's documentation for settings, 0 = unlimited"
    )
    basic_settings_page_input_token_threshold_title: str = "Task Input Length Threshold"
    basic_settings_page_input_token_threshold_content: str = "Maximum number of text tokens contained in each task input"
    basic_settings_page_output_token_threshold_title: str = "Task Output Length Threshold"
    basic_settings_page_output_token_threshold_content: str = "Maximum number of text tokens contained in each task output"
    basic_settings_page_request_timeout_title: str = "Request Timeout"
    basic_settings_page_request_timeout_content: str = (
        "The maximum time (seconds) to wait for the model's response when making a request"
        "<br>"
        "If no reply is received after the timeout, the task will be considered failed"
    )
    basic_settings_page_max_round_title: str = "Maximum Rounds"
    basic_settings_page_max_round_content: str = "After completing a round of tasks, failed tasks will be retried in a new round until all are completed or the round threshold is reached"

    # 专家设置
    expert_settings_page_preceding_lines_threshold: str = "Preceding Lines Threshold"
    expert_settings_page_preceding_lines_threshold_desc: str = "Maximum number of preceding lines to include as context for each translation task, disabled by default"
    expert_settings_page_preceding_disable_on_local: str = "Enable Preceding Lines for Local Interface"
    expert_settings_page_preceding_disable_on_local_desc: str = "Local models perform relatively poorly, so the preceding Lines feature often has negative effects, disabled by default"
    expert_settings_page_clean_ruby: str = "Clean Ruby Text"
    expert_settings_page_clean_ruby_desc: str = (
        "Removes the phonetic ruby characters from annotations, retaining only the main text, disabled by default"
        "<br>"
        "Ruby annotations in text are often not correctly understood by the model, cleaning them can improve translation quality"
        "<br>"
        "Supported ruby formats include, but are not limited to:"
        "<br>"
        "• (漢字/かんじ) [漢字/かんじ] |漢字[かんじ]"
        "<br>"
        "• \\r[漢字,かんじ] \\rb[漢字,かんじ] [r_かんじ][ch_漢字] [ch_漢字]"
        "<br>"
        "• [ruby text=かんじ] [ruby text = かんじ] [ruby text=\"かんじ\"] [ruby text = \"かんじ\"]"
    )
    expert_settings_page_deduplication_in_trans: str = "Deduplicate Repeated Text in T++ Project File"
    expert_settings_page_deduplication_in_trans_desc: str = "In T++ project file (i.e., <font color='darkgoldenrod'><b>.trans</b></font> file), whether to deduplicate repeated text, enabled by default"
    expert_settings_page_deduplication_in_bilingual: str = "Output Only Once if Source and Target are Identical in Bilingual Output Files"
    expert_settings_page_deduplication_in_bilingual_desc: str = "In subtitles or e-books, whether to output text only once if the source and target text are identical, enabled by default"
    expert_settings_page_write_translated_name_fields_to_file: str = "Write Translated Name Fields to the Output File"
    expert_settings_page_write_translated_name_fields_to_file_desc: str = (
        "In some <font color='darkgoldenrod'><b>GalGame</b></font>, name field data is bound to resource files such as image or voice files"
        "<br>"
        "Translating these name fields can cause errors. In such cases, this feature can be disabled, enabled by default"
        "<br>"
        "Supported formats:"
        "<br>"
        "• RenPy exported game text (.rpy)"
        "<br>"
        "• VNTextPatch or SExtractor exported game text with name fields (.json)"
    )
    expert_settings_page_result_checker_retry_count_threshold: str = "Result Checker - Retry Count Reached Threshold"
    expert_settings_page_result_checker_retry_count_threshold_desc: str = (
        "Include a list of items that <font color='darkgoldenrod'><b>reached the retry threshold</b></font> in the result check report, disabled by default"
        "<br>"
        "• During translation result checks, if an item still fails after reaching the retry threshold, the last result is used"
        "<br>"
        "• This feature allows you to individually verify if the final result taken is actually correct"
    )

    # 质量类通用
    quality_import: str = "Import"
    quality_import_toast: str = "Data imported …"
    quality_export: str = "Export"
    quality_export_toast: str = "Data exported …"
    quality_save: str = "Save"
    quality_save_toast: str = "Data saved …"
    quality_merge_duplication: str = "Duplicate data merged …"
    quality_preset: str = "Preset"
    quality_reset: str = "Reset"
    quality_reset_toast: str = "Data reset …"
    quality_reset_alert: str = "Confirm reset to default data … ?"
    quality_select_file: str = "Select File"
    quality_select_file_type: str = "Support Format (*.json *.xlsx)"
    quality_delete_row: str = "Delete Row"
    quality_switch_regex: str = "Regex Switch"

    # 规则列
    rule_column_name: str = "Rule"
    rule_regex: str = "Regular Expression"
    rule_regex_on: str = "Current Status: Enabled"
    rule_regex_off: str = "Current Status: Disabled"
    rule_case_sensitive: str = "Case Sensitive"
    rule_case_sensitive_on: str = "Current Status: Enabled"
    rule_case_sensitive_off: str = "Current Status: Disabled"

    # 术语表
    glossary_page_head_title: str = "Glossary"
    glossary_page_head_content: str = "By building a glossary in the prompt to guide model translation, unified translation and correction of personal pronouns can be achieved"
    glossary_page_table_row_01: str = "Original"
    glossary_page_table_row_02: str = "Translated"
    glossary_page_table_row_03: str = "Advanced Rule"
    glossary_page_table_row_04: str = "Description"
    glossary_page_kg: str = "One-Click Tools"

    # 文本保护
    text_preserve_page_head_title: str = "Custom Text Preserve Rules"
    text_preserve_page_head_content: str = (
        "Preserve text segments like code snippets, control characters, and style characters that shouldn't be translated, preventing incorrect translation"
        "<br>"
        "<font color='darkgoldenrod'><b>Disabled by default</b></font>, before enabling, please carefully read the feature description in the <font color='darkgoldenrod'><b>Wiki</b></font> to ensure you fully understand how to use it"
        "<br>"
        "• Enabled - Preserve text by matching it against the <font color='darkgoldenrod'><b>Regular Expression Rules</b></font> set on this page"
        "<br>"
        "• Disabled - Automatically detects text format and game engine, and applies smart preserve rules, works well for most content"
    )
    text_preserve_page_table_row_01: str = "Rule"
    text_preserve_page_table_row_02: str = "Remarks (For reference only, has no actual effect)"

    # 译前替换
    pre_translation_replacement_page_head_title: str = "Pre-translation Replacement"
    pre_translation_replacement_page_head_content: str = (
        "Before translation, matched parts of the original text will be replaced by specified text, processed in top-down order"
        "<br>"
        "For <font color='darkgoldenrod'><b>RPGMaker MV/MZ</b></font> engine games:"
        "<br>"
        "• Importing <font color='darkgoldenrod'><b>actors.json</b></font> from <font color='darkgoldenrod'><b>data</b></font> or <font color='darkgoldenrod'><b>www\\data</b></font> in the game directory can improve translation quality"
        "<br>"
        "• Special handling is needed for games with custom names. Click the bottom-right button to see <font color='darkgoldenrod'><b>Wiki</b></font> instructions"
    )
    pre_translation_replacement_page_table_row_01: str = "Original"
    pre_translation_replacement_page_table_row_02: str = "Replacement"
    pre_translation_replacement_page_table_row_03: str = "Advanced Rule"

    # 译后替换
    post_translation_replacement_page_head_title: str = "Post-translation Replacement"
    post_translation_replacement_page_head_content: str = "After translation is completed, replace the matched parts in the translated text with the specified text, the execution order is from top to bottom"
    post_translation_replacement_page_table_row_01: str = "Original"
    post_translation_replacement_page_table_row_02: str = "Replacement"
    post_translation_replacement_page_table_row_03: str = "Advanced Rule"

    # 自定义提示词 - 中文
    custom_prompt_zh_page_head: str = "Custom Chinese Prompts (SakuraLLM model not supported)"
    custom_prompt_zh_page_head_desc: str = (
        "Add extra translation requirements such as story settings and writing styles via custom prompts"
        "<br>"
        "Note: The prefix and suffix are fixed and cannot be modified"
        "<br>"
        "The custom prompts on this page will only be used when the <font color='darkgoldenrod'><b>translation language is set to Chinese</b></font>"
    )

    # 自定义提示词 - 英文
    custom_prompt_en_page_head: str = "Custom English Prompts (SakuraLLM model not supported)"
    custom_prompt_en_page_head_desc: str = (
        "Add extra translation requirements such as story settings and writing styles via custom prompts"
        "<br>"
        "Note: The prefix and suffix are fixed and cannot be modified"
        "<br>"
        "The custom prompts on this page will only be used when the <font color='darkgoldenrod'><b>translation language is set to non-Chinese</b></font>"
    )

    # 实验室
    laboratory_page_mtool_optimizer_enable: str = "MTool Optimizer"
    laboratory_page_mtool_optimizer_enable_desc: str = (
        "Can reduce translation time and token usage by up to 40% when translating MTool text"
        "<br>"
        "May lead to issues like <font color='darkgoldenrod'><b>residual original text</b></font> or <font color='darkgoldenrod'><b>incoherent sentences</b></font>"
        "<br>"
        "It should <font color='darkgoldenrod'><b>only be enabled when translating MTool text</b></font>"
        "<br>"
        "Please <font color='darkgoldenrod'><b>decide for yourself</b></font> whether to enable this feature"
        ""
        ""
    )
    laboratory_page_auto_glossary_enable: str = "Auto Complete Glossary (Does not support SakuraLLM)"
    laboratory_page_auto_glossary_enable_desc: str = (
        "Attempts to automatically add missing proper noun entries to the glossary during translation"
        "<br>"
        "This is effective only when the <font color='darkgoldenrod'><b>Glossary feature is enabled</b></font>"
        "<br>"
        "Designed to supplement, not replace, <font color='darkgoldenrod'><b>KeywordGacha</b></font>, acquired terms are <font color='darkgoldenrod'><b>written directly to the glossary</b></font>"
        "<br>"
        "May generate <font color='darkgoldenrod'><b>incorrect or inappropriate terminology entries</b></font>, please <font color='darkgoldenrod'><b>use your own judgment</b></font> on whether to enable it"
        "<br>"
        "It is recommended to use this feature only with powerful models like DeepSeek V3/R1"
    )

    # 百宝箱
    tool_box_page_batch_correction: str = "Batch Correction"
    tool_box_page_batch_correction_desc: str = "Checks the translated file against the generated translation results and performs batch correction on potential errors, enabling quick refinement of translation outputs"
    tool_box_page_re_translation: str = "Partial Re-Translation"
    tool_box_page_re_translation_desc: str = "Re-translate parts of already translated text based on set filters, mainly for content updates or error correction"
    tool_box_page_name_field_extraction: str = "Name-Field Extraction"
    tool_box_page_name_field_extraction_desc: str = (
        "Extract character name field data from <font color='darkgoldenrod'><b>RenPy</b></font> and <font color='darkgoldenrod'><b>GalGame</b></font> game text, "
        "and automatically generate corresponding glossary data to facilitate subsequent translation"
    )

    # 百宝箱 - 批量修正
    batch_correction_page: str = "Batch Correction"
    batch_correction_page_desc: str = (
        "Inspects data in files from translation results to batch correct potential errors, then generates corrected translation files"
        "<br>"
        "Workflow:"
        "<br>"
        "• Extracts data that may need correction from the translation result inspection file in the <font color='darkgoldenrod'><b>input folder</b></font>"
        "<br>"
        "• Checks the extracted data and corrects the entries that need correction according to the actual situation"
        "<br>"
        "• Inject the corrected data into the translated files within the <font color='darkgoldenrod'><b>Input folder</b></font>, and then generate the corrected translated files in the <font color='darkgoldenrod'><b>Output folder</b></font>"
    )
    batch_correction_page_step_01: str = "Step 1 - Generate Correction Data"
    batch_correction_page_step_01_desc: str = (
        "Extract data that may contain translation errors from the result check file"
        "<br>"
        f"Then automatically generate a data file for editing named <font color='darkgoldenrod'><b>{path_result_batch_correction}</b></font> in the <font color='darkgoldenrod'><b>Output Folder</b></font>"
    )
    batch_correction_page_step_02: str = "Step 2 - Inject Correction Data"
    batch_correction_page_step_02_desc: str = (
        "Check the content in the data file, and after confirming everything is correct, <font color='darkgoldenrod'><b>close</b></font> the file to start injection"
        "<br>"
        "Please note:"
        "<br>"
        "• Except for the <font color='darkgoldenrod'><b>correction column</b></font>, do not modify other data within the data file"
        "<br>"
        "• Filenames of some formats may contain language suffix like <font color='darkgoldenrod'><b>.zh</b></font>, remove it before injection for correct data matching"
    )
    batch_correction_page_title_01: str = "File Name"
    batch_correction_page_title_02: str = "Error Type"
    batch_correction_page_title_03: str = "Original Text (Do not modify this column)"
    batch_correction_page_title_04: str = "Translated Text (Do not modify this column)"
    batch_correction_page_title_05: str = "Correction (Please modify this column)"

    # 百宝箱 - 部分重翻
    re_translation_page: str = "Partial Re-Translation"
    re_translation_page_desc: str = (
        "Will filter the text in the <font color='darkgoldenrod'><b>Input Folder</b></font> based on the set filter conditions, and then retranslate the text that meets the conditions"
        "<br>"
        "Workflow:"
        "<br>"
        "• Load the original and translated texts from the <font color='darkgoldenrod'><b>src</b></font> and <font color='darkgoldenrod'><b>dst</b></font> subdirectories of the <font color='darkgoldenrod'><b>Input Folder</b></font>"
        "<br>"
        "• The filenames and file contents of the original and translated files must correspond strictly one-to-one"
        "<br>"
        "• Filter out the text that needs to be retranslated according to the settings on this page, translate it according to the normal process"
    )
    re_translation_page_white_list: str = "Keywords - Whitelist"
    re_translation_page_white_list_desc: str = (
        "Text containing these keywords will be retranslated. You can enter multiple keywords, one per line"
        "\n"
        "Hitting one of them is enough to determine that the text needs to be retranslated"
    )
    re_translation_page_alert_not_equal: str = "The number of lines in the original and translated texts does not match …"

    # 百宝箱 - 姓名字段提取
    name_field_extraction_page: str = "Name-Field Extraction"
    name_field_extraction_page_desc: str = (
        "Extract character name fields from all eligible files in the <font color='darkgoldenrod'><b>input folder</b></font> and automatically generate corresponding glossary data"
        "<br>"
        "Please note: This function <font color='darkgoldenrod'><b>cannot extract terms from the main text</b></font>, and cannot replace the <font color='darkgoldenrod'><b>KeywordGacha</b></font> tool"
        "<br>"
        "Supported formats:"
        "<br>"
        "• RenPy exported game text (.rpy)"
        "<br>"
        "• VNTextPatch or SExtractor exported game text with name fields (.json)"
    )
    name_field_extraction_page_step_01: str = "Step 1 - Extract Data"
    name_field_extraction_page_step_01_desc: str = (
        "Extract name fields and their related context, and send them to the translator for translation"
        "<br>"
        f"After translation is complete, the <font color='darkgoldenrod'><b>{path_result_name_field_extraction}</b></font> file will be generated in the <font color='darkgoldenrod'><b>Output Folder</b></font>"
    )
    name_field_extraction_page_step_02: str = "Step 2 - Generate Glossary"
    name_field_extraction_page_step_02_desc: str = (
        f"Extract translated data from the <font color='darkgoldenrod'><b>{path_result_name_field_extraction}</b></font> file in the <font color='darkgoldenrod'><b>Output Folder</b></font>"
        "<br>"
        "Then generate the corresponding glossary data, check if the generated glossary data is correct"
    )
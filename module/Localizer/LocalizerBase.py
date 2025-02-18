class LocalizerBase():

    # 保留
    switch_language: str = "请选择应用语言，新的语言设置将在下次启动时生效！\nSelect application language, changes will take effect on restart!"
    switch_language_toast: str = "应用语言切换成功，请重启应用生效 ...\nLanguage switched successfully, please restart the application for changes to take effect..."

    # 通用
    add: str = "新增"
    edit: str = "修改"
    none: str = "无"
    stop: str = "停止"
    start: str = "开始"
    close: str = "关闭"
    alert: str = "提醒"
    warning: str = "警告"
    confirm: str = "确认"
    cancel: str = "取消"
    enable: str = "启用"
    disable: str = "禁用"
    auto: str = "自动"
    select_file: str = "选择文件"
    select_file_type: str = "json 文件 (*.json);;xlsx 文件 (*.xlsx)"

    # 主页面
    app_close_message_box: str = "确定是否退出程序 ... ？"
    app_close_message_box_msg: str = "主窗口已关闭，稍后应用将自动退出 ..."
    app_theme_btn: str = "变换自如"
    app_language_btn: str = "字字珠玑"
    app_settings_page: str = "应用设置"
    app_platform_page: str = "接口管理"
    app_project_page: str = "项目设置"
    app_translation_page: str = "开始翻译"
    app_basic_settings_page: str = "基础设置"
    app_advance_Feature_page: str = "高级功能"
    app_glossary_page: str = "术语表"
    app_pre_translation_replacement_page: str = "译前替换"
    app_post_translation_replacement_page: str = "译后替换"
    app_custom_prompt_navigation_item: str = "自定义提示词"
    app_custom_prompt_zh_page: str = "中文提示词"
    app_custom_prompt_en_page: str = "英文提示词"

    # 路径
    path_bilingual: str = "双语对照"
    path_glossary_export = "导出_术语表.json"
    path_pre_translation_replacement_export = "导出_译前替换.json"
    path_post_translation_replacement_export = "导出_译后替换.json"
    path_result_check_code = "结果检查_代码异常的条目.json"
    path_result_check_glossary = "结果检查_术语表未生效的条目.json"
    path_result_check_untranslated = "结果检查_翻译状态异常的条目.json"

    # 日志
    log_debug_mode: str = "调试模式已启用 ..."
    log_config_file_not_exist: str = "配置文件不存在 ..."
    log_api_test_fail: str = "接口测试失败 ... "
    log_task_fail: str = "翻译任务失败 ..."
    log_read_file_fail: str = "文件读取失败 ..."
    log_write_file_fail: str = "文件写入失败 ..."
    log_load_cache_file_fail: str = "从文件读取缓存数据失败 ..."
    log_load_llama_cpp_slots_num_fail: str = "无法获取 [green]llama.cpp[/] 的响应数据 ..."
    translator_max_round: str = "最大轮次"
    translator_current_round: str = "当前轮次"
    translator_api_url: str = "接口地址"
    translator_name: str = "接口名称"
    translator_model: str = "模型名称"
    translator_proxy_url: str = "生效中的 网络代理"
    translator_prompt: str = "本次任务使用以下提示词：\n{PROMPT}\n"
    translator_begin: str = "即将开始执行翻译任务，预计任务总数为 {TASKS}, 并发任务数为 {BATCH_SIZE}，请注意保持网络通畅 ..."
    translator_writing: str = "正在写入翻译数据，等稍候 ..."
    translator_done: str = "所有文本均已翻译，翻译任务已结束 ..."
    translator_fail: str = "已到最大翻译轮次，仍有部分文本未翻译，请检查翻译结果 ..."
    translator_stop: str = "翻译任务已停止 ..."
    translator_write: str = "翻译结果已保存至 {PATH} 目录 ..."
    translator_generate_task: str = "生成翻译任务"
    translator_rule_filter: str = "规则过滤已完成，共过滤 {COUNT} 个无需翻译的条目 ..."
    translator_mtool_filter: str = "MToolOptimizer 预处理已完成，共过滤 {COUNT} 个包含重复子句的条目 ..."
    translator_language_filter: str = "语言过滤已完成，共过滤 {COUNT} 个不包含目标语言的条目 ..."
    translator_task_response_think: str = "模型思考内容：\n"
    translator_task_response_result: str = "模型回复内容：\n"
    translator_response_check_fail: str = "译文文本未通过检查，将在下一轮次的翻译中自动重试"
    translator_response_check_fail_part: str = "部分译文文本未通过检查，将在下一轮次的翻译中自动重试"
    translator_task_success: str = "任务耗时 {TIME} 秒，文本行数 {LINES} 行，输入消耗 {PT} Tokens，输出消耗 {CT} Tokens"
    file_checker_code: str = "已完成代码检查，未发现异常条目 ..."
    file_checker_code_full: str = "已完成代码检查，发现 {COUNT} 个异常条目，占比为 {PERCENT} %，结果已写入 {TARGET} ..."
    file_checker_glossary: str = "已完成术语表检查，未发现异常条目 ..."
    file_checker_glossary_full: str = "已完成术语表检查，发现 {COUNT} 个异常条目，占比为 {PERCENT} %，结果已写入 {TARGET} ..."
    file_checker_translation: str = "已完成翻译状态检查，未发现异常条目 ..."
    file_checker_translation_full: str = "已完成翻译状态检查，发现 {COUNT} 个异常条目，占比为 {PERCENT} %，结果已写入 {TARGET} ..."
    file_checker_translation_alert_key: str = "____说明____"
    file_checker_translation_alert_value: str = "本文件内列出的是 **可能** 存在漏翻情况的条目，实际是否漏翻请结合上下文语境判断！"
    platofrm_tester_key: str = "正在测试密钥"
    platofrm_tester_proxy: str = "网络代理已启动，代理地址："
    platofrm_tester_messages: str = "正在发送提示词"
    platofrm_tester_response_think: str = "模型思考内容"
    platofrm_tester_response_result: str = "模型返回结果"
    platofrm_tester_result: str = "共测试 {COUNT} 个接口，成功 {SUCCESS} 个，失败 {FAILURE} 个 ..."
    response_checker_unknown: str = "未知"
    response_checker_fail_data: str = "返回结果错误（数据结构）"
    response_checker_fail_line: str = "返回结果错误（数据行数）"
    response_checker_untranslated: str = "返回结果中存在没有翻译的内容"
    response_decoder_glossary_by_json: str = "术语数据 [bright_blue]->[/] 反序列化，共 {COUNT} 条"
    response_decoder_glossary_by_rule: str = "术语数据 [bright_blue]->[/] 规则解析，共 {COUNT} 条"
    response_decoder_translation_by_json: str = "翻译数据 [bright_blue]->[/] 反序列化，共 {COUNT} 条"
    response_decoder_translation_by_rule: str = "翻译数据 [bright_blue]->[/] 规则解析，共 {COUNT} 条"

    # 应用设置
    app_settings_page_proxy_url = "请输入网络代理地址 ..."
    app_settings_page_proxy_url_title = "网络代理地址"
    app_settings_page_proxy_url_content = "启用该功能后，将使用设置的代理地址向接口发送请求，例如 http://127.0.0.1:7890"
    app_settings_page_font_hinting_title = "应用字体优化"
    app_settings_page_font_hinting_content = "启用此功能后，字体的边缘渲染将更加圆润（将在应用重启后生效）"
    app_settings_page_debug_title = "调试模式"
    app_settings_page_debug_content = "启用此功能后，应用将显示额外的调试信息"
    app_settings_page_scale_factor_title = "全局缩放比例"
    app_settings_page_scale_factor_content = "启用此功能后，应用界面将按照所选比例进行缩放（将在应用重启后生效）"

    # 接口管理
    platform_page_api_test_doing: str = "接口测试正在执行中，请稍后再试 ..."
    platform_page_api_test_result: str = "接口测试结果：成功 {SUCCESS} 个，失败 {FAILURE} 个 ..."
    platform_page_api_activate: str = "激活接口"
    platform_page_api_edit: str = "编辑接口"
    platform_page_api_args: str = "编辑参数"
    platform_page_api_test: str = "测试接口"
    platform_page_api_delete: str = "删除接口"
    platform_page_widget_add_title: str = "接口列表"
    platform_page_widget_add_content: str = "在此添加和管理任何兼容 OpenAI、Anthropic 格式的 LLM 模型接口"

    # 接口编辑
    platform_edit_page_name: str = "请输入接口名称 ..."
    platform_edit_page_name_title: str = "接口名称"
    platform_edit_page_name_content: str = "请输入接口名称，仅用于应用内显示，无实际作用"
    platform_edit_page_api_url: str = "请输入接口地址 ..."
    platform_edit_page_api_url_title: str = "接口地址"
    platform_edit_page_api_url_content: str = "请输入接口地址，请注意辨别结尾是否需要添加 /v1"
    platform_edit_page_api_key: str = "请输入接口密钥 ..."
    platform_edit_page_api_key_title: str = "接口密钥"
    platform_edit_page_api_key_content: str = "请输入接口密钥，例如 sk-d0daba12345678fd8eb7b8d31c123456，填入多个密钥可以轮询使用，每行一个"
    platform_edit_page_api_format_title: str = "接口格式"
    platform_edit_page_api_format_content: str = "请选择接口格式，大部分平台兼容 OpenAI 格式，部分平台的 Claude 模型则使用 Anthropic 格式"
    platform_edit_page_model: str = "请输入模型名称 ..."
    platform_edit_page_model_title: str = "模型名称"
    platform_edit_page_model_content: str = "当前使用的模型为 {MODEL}"
    platform_edit_page_model_edit: str = "手动输入"
    platform_edit_page_model_sync: str = "在线获取"

    # 参数编辑
    args_edit_page_top_p_title: str = "top_p"
    args_edit_page_top_p_content: str = "请谨慎设置，错误的值可能导致结果异常或者请求报错"
    args_edit_page_temperature_title: str = "temperature"
    args_edit_page_temperature_content: str = "请谨慎设置，错误的值可能导致结果异常或者请求报错"
    args_edit_page_presence_penalty_title: str = "presence_penalty"
    args_edit_page_presence_penalty_content: str = "请谨慎设置，错误的值可能导致结果异常或者请求报错"
    args_edit_page_frequency_penalty_title: str = "frequency_penalty"
    args_edit_page_frequency_penalty_content: str = "请谨慎设置，错误的值可能导致结果异常或者请求报错"
    args_edit_page_document_link: str = "点击查看文档"

    # 模型列表
    model_list_page_title: str = "可用的模型列表"
    model_list_page_content: str = "点击选择要使用的模型"
    model_list_page_fail: str = "获取模型列表失败，请检查接口配置 ..."

    # 项目设置
    project_page_source_language_title: str = "原文语言"
    project_page_source_language_content: str = "设置当前翻译项目所使用的原文文本的语言"
    project_page_source_language_items: str = "中文,英文,日文,韩文,俄文"
    project_page_target_language_title: str = "译文语言"
    project_page_target_language_content: str = "设置当前翻译项目所使用的译文文本的语言"
    project_page_target_language_items: str = "中文,英文,日文,韩文,俄文"
    project_page_input_folder_title: str = "输入文件夹"
    project_page_input_folder_content: str = "当前输入文件夹为"
    project_page_input_folder_btn: str = "选择文件夹"
    project_page_output_folder_title: str = "输出文件夹（不能与输入文件夹相同）"
    project_page_output_folder_content: str = "当前输出文件夹为"
    project_page_output_folder_btn: str = "选择文件夹"
    project_page_traditional_chinese_title: str = "使用繁体输出中文"
    project_page_traditional_chinese_content: str = "启用此功能后，在译文语言设置为中文时，将使用繁体字形输出中文文本"

    # 开始翻译
    translation_page_status_idle = "无任务"
    translation_page_status_api_testing = "测试中"
    translation_page_status_translating = "翻译中"
    translation_page_status_stoping = "停止中"
    translation_page_indeterminate_saving = "缓存文件保存中 ..."
    translation_page_indeterminate_stoping = "正在停止翻译任务 ..."
    translation_page_card_time = "累计时间"
    translation_page_card_remaining_time = "剩余时间"
    translation_page_card_line = "翻译行数"
    translation_page_card_remaining_line = "剩余行数"
    translation_page_card_speed = "平均速度"
    translation_page_card_token = "累计消耗"
    translation_page_card_task = "实时任务数"
    translation_page_alert_start = "将重置尚未完成的翻译任务，是否确认开始新的翻译任务 ... ？"
    translation_page_alert_pause = "停止的翻译任务可以随时继续翻译，是否确定停止任务 ... ？"
    translation_page_continue = "继续翻译"
    translation_page_export = "导出翻译数据"
    translation_page_export_toast = "已根据当前的翻译数据在输出文件夹下生成翻译文件 ..."

    # 基础设置
    basic_settings_page_batch_size_title = "并发任务数"
    basic_settings_page_batch_size_content = "同时执行的翻译任务的最大数量，合理设置可以极大的增加翻译速度，请参考接口平台的限制进行设置，本地接口无需设置"
    basic_settings_page_task_token_limit_title = "翻译任务长度阈值"
    basic_settings_page_task_token_limit_content = "每个翻译任务一次性向模型发送的文本长度的最大值，单位为 Token"
    basic_settings_page_request_timeout_title = "请求超时时间"
    basic_settings_page_request_timeout_content = "翻译任务发起请求时等待模型回复的最长时间，超时仍未收到回复，则会判断为任务失败，单位为秒，不支持"
    basic_settings_page_max_round_title = "翻译流程最大轮次"
    basic_settings_page_max_round_content = "当完成一轮翻译后，如果还有未翻译的条目，将重新开始新的翻译流程，直到翻译完成或者达到最大轮次"

    # 高级功能
    advance_feature_page_auto_glossary_enable_title = "自动补全术语表（实验性功能，不支持 SakuraLLM 模型）"
    advance_feature_page_auto_glossary_enable_content = (
        "启用此功能后，在翻译的同时将对文本进行分析，尝试自动补全术语表中缺失的专有名词条目。"
        + "\n" + "此功能设计目的仅为查漏补缺，并不能代替手动制作的术语表，只有在 **启用术语表功能** 时才生效。"
        + "\n" + "可能导致 **负面效果** 或 **翻译异常**，理论上只有在 DeepSeek V3/R1 等强力模型上才会有正面效果，请 **自行判断** 是否启用。"
    )
    advance_feature_page_mtool_optimizer_enable_title = "MTool 优化器"
    advance_feature_page_mtool_optimizer_enable_content = (
        "启用此功能后，在对 MTool 文本进行翻译时，至多可减少 40% 的 翻译时间 与 Token 消耗。"
        + "\n" + "可能导致 **原文残留** 或 **语句不连贯** 等问题，请 **自行判断** 是否启用，并且只应在 **翻译 MTool 文本时** 启用。"
    )

    # 术语表
    glossary_page_head_title = "术语表"
    glossary_page_head_content = "通过在提示词中构建术语表来引导模型翻译，可实现统一翻译、矫正人称属性等功能"
    glossary_page_table_row_01 = "原文"
    glossary_page_table_row_02 = "译文"
    glossary_page_table_row_03 = "描述"
    glossary_page_import = "导入"
    glossary_page_import_toast = "数据已导入 ..."
    glossary_page_export = "导出"
    glossary_page_export_toast = "数据已导出到应用根目录 ..."
    glossary_page_add = "添加"
    glossary_page_add_toast = "新行已添加 ..."
    glossary_page_save = "保存"
    glossary_page_save_toast = "数据已保存 ..."
    glossary_page_reset = "重置"
    glossary_page_reset_toast = "数据已重置 ..."
    glossary_page_reset_alert = "是否确认重置为默认数据 ... ？"
    glossary_page_kg = "一键制作工具"
    glossary_page_wiki = "功能说明"

    # 译前替换
    pre_translation_replacement_page_head_title = "译前替换"
    pre_translation_replacement_page_head_content = (
        "在翻译开始前，将原文中匹配的部分替换为指定的文本，执行的顺序为从上到下依次替换"
        + "\n" + "翻译 RPGMaker MV/MZ 游戏时，导入 data 或 www\\data 文件夹内的 Actors.json 文件可以显著提升翻译质量"
    )
    pre_translation_replacement_page_table_row_01 = "原文"
    pre_translation_replacement_page_table_row_02 = "替换"
    pre_translation_replacement_page_import = "导入"
    pre_translation_replacement_page_import_toast = "数据已导入 ..."
    pre_translation_replacement_page_export = "导出"
    pre_translation_replacement_page_export_toast = "数据已导出到应用根目录 ..."
    pre_translation_replacement_page_add = "添加"
    pre_translation_replacement_page_add_toast = "新行已添加 ..."
    pre_translation_replacement_page_save = "保存"
    pre_translation_replacement_page_save_toast = "数据已保存 ..."
    pre_translation_replacement_page_reset = "重置"
    pre_translation_replacement_page_reset_toast = "数据已重置 ..."
    pre_translation_replacement_page_reset_alert = "是否确认重置为默认数据 ... ？"
    pre_translation_replacement_page_wiki = "功能说明"

    # 译后替换
    post_translation_replacement_page_head_title = "译后替换"
    post_translation_replacement_page_head_content = "在翻译完成后，将译文中匹配的部分替换为指定的文本，执行的顺序为从上到下依次替换"
    post_translation_replacement_page_table_row_01 = "原文"
    post_translation_replacement_page_table_row_02 = "替换"
    post_translation_replacement_page_import = "导入"
    post_translation_replacement_page_import_toast = "数据已导入 ..."
    post_translation_replacement_page_export = "导出"
    post_translation_replacement_page_export_toast = "数据已导出到应用根目录 ..."
    post_translation_replacement_page_add = "添加"
    post_translation_replacement_page_add_toast = "新行已添加 ..."
    post_translation_replacement_page_save = "保存"
    post_translation_replacement_page_save_toast = "数据已保存 ..."
    post_translation_replacement_page_reset = "重置"
    post_translation_replacement_page_reset_toast = "数据已重置 ..."
    post_translation_replacement_page_reset_alert = "是否确认重置为默认数据 ... ？"
    post_translation_replacement_page_wiki = "功能说明"

    # 自定义提示词 - 中文
    custom_prompt_zh_page_head_title = "译文语言设置为中文时使用的自定义提示词（不支持 SakuraLLM 模型）"
    custom_prompt_zh_page_head_content = (
        "通过自定义提示词追加故事设定、行文风格等额外翻译要求。"
        + "\n" + "注意：前缀、后缀部分固定不可修改，只有 **译文语言设置为中文时** 才会使用本页中的自定义提示词。"
    )
    custom_prompt_zh_page_save = "保存"
    custom_prompt_zh_page_save_toast = "数据已保存 ..."
    custom_prompt_zh_page_reset = "重置"
    custom_prompt_zh_page_reset_toast = "数据已重置 ..."
    custom_prompt_zh_page_reset_alert = "是否确认重置为默认数据 ... ？"

    # 自定义提示词 - 英文
    custom_prompt_en_page_head_title = "译文语言设置为非中文时使用的自定义提示词（不支持 SakuraLLM 模型）"
    custom_prompt_en_page_head_content = (
        "通过自定义提示词追加故事设定、行文风格等额外翻译要求。"
        + "\n" + "注意：前缀、后缀部分固定不可修改，只有 **译文语言设置为非中文时** 才会使用本页中的自定义提示词。"
    )
    custom_prompt_en_page_save = "保存"
    custom_prompt_en_page_save_toast = "数据已保存 ..."
    custom_prompt_en_page_reset = "重置"
    custom_prompt_en_page_reset_toast = "数据已重置 ..."
    custom_prompt_en_page_reset_alert = "是否确认重置为默认数据 ... ？"
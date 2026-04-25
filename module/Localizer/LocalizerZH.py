# 用于保持与英文的行数对齐，请勿移除
# 用于保持与英文的行数对齐，请勿移除
# 用于保持与英文的行数对齐，请勿移除
class LocalizerZH:
    # 通用
    api_url: str = "接口地址"
    issue_kana_residue: str = "假名残留"
    issue_hangeul_residue: str = "谚文残留"
    task_failed: str = "任务执行失败 …"
    task_success: str = "任务执行成功 …"
    task_running: str = "任务正在执行中 …"
    task_processing: str = "处理中 …"
    export_translation_start: str = "生成译文中 …"
    export_translation_done: str = "译文已保存至 [blue]{PATH}[/blue] …"
    export_translation_success: str = "译文生成完成 …"
    export_translation_failed: str = "译文生成失败 …"
    alert_project_not_loaded: str = "请先加载工程文件 …"
    alert_no_active_model: str = "未找到激活的模型配置 …"
    alert_no_data: str = "没有有效数据 …"
    alert_invalid_export_data: str = "导出数据无效 …"

    # 主页面
    app_exit_countdown: str = "退出中 … {SECONDS} …"
    app_new_version_found: str = "已找到新版本，版本号为 {VERSION}，请点击左下角按钮下载更新 …"
    app_new_version_failure: str = "新版本下载失败 … "
    app_new_version_success: str = "新版本下载成功 … "
    app_new_version_apply_failed: str = "更新失败，已回滚 …"
    app_new_version_waiting_restart: str = "更新完成，应用即将关闭 …"
    app_glossary_page: str = "术语表"
    app_text_preserve_page: str = "文本保护"
    app_pre_translation_replacement_page: str = "译前替换"
    app_post_translation_replacement_page: str = "译后替换"
    app_analysis_prompt_page: str = "分析提示词"
    app_translation_prompt_page: str = "翻译提示词"

    # 路径
    path_translated: str = "译文"
    path_translated_bilingual: str = "译文_双语对照"

    # 日志
    log_crash: str = "出现严重错误，应用即将退出，错误信息已保存至日志文件 …"
    log_api_test_fail: str = (
        "接口测试失败 …"
        "\n"
        "原因：{REASON}"
    )
    log_read_file_fail: str = "文件读取失败 …"
    log_write_file_fail: str = "文件写入失败 …"
    log_unknown_reason: str = "未知原因"

    # 引擎
    engine_no_items: str = "没有找到需要处理数据，请确认 …"
    engine_task_done: str = "任务已完成 …"
    engine_task_fail: str = "任务未能全部完成，仍有部分数据未处理，请检查处理结果 …"
    engine_task_stop: str = "任务已停止 …"
    engine_task_rule_filter: str = "规则过滤已完成，共过滤 {COUNT} 个无需翻译的条目 …"
    engine_task_language_filter: str = "语言过滤已完成，共过滤 {COUNT} 个非目标原文语言条目 …"
    engine_task_success: str = "任务耗时 {TIME} 秒，文本行数 {LINES} 行，输入消耗 {PT} Tokens，输出消耗 {CT} Tokens"
    engine_task_simple_log_prefix: str = "简略日志"
    engine_task_response_think: str = "模型思考内容："
    engine_task_response_result: str = "模型回复内容："
    translation_task_status_info: str = "拆分次数：{SPLIT} | 单条重试次数：{RETRY} | 任务长度阈值：{THRESHOLD}"
    translation_task_force_accept_info: str = " | 已强制放行：{REASON}"
    engine_api_name: str = "接口名称"
    engine_api_model: str = "接口模型"
    api_test_key: str = "正在测试密钥："
    api_test_messages: str = "任务提示词："
    api_test_timeout: str = "请求超时（{SECONDS} 秒）"
    api_test_result: str = "共测试 {COUNT} 个接口，成功 {SUCCESS} 个，失败 {FAILURE} 个 …"
    api_test_result_failure: str = "失败的密钥："
    api_test_token_info: str = "Token 使用：输入 {INPUT}，输出 {OUTPUT}，耗时 {TIME} 秒"
    translation_mtool_optimizer_pre_log: str = "MToolOptimizer 预处理已完成，共过滤 {COUNT} 个包含重复子句的条目 …"
    translation_mtool_optimizer_post_log: str = "MToolOptimizer 后处理已完成 …"
    translation_response_check_fail: str = "返回数据错误，将自动重试，原因：{REASON}"
    translation_response_check_fail_all: str = "全部译文质量校验失败，将自动切分重试，原因：{REASON}"
    translation_response_check_fail_part: str = "部分译文质量校验失败，将自动切分重试，原因：{REASON}"
    translation_response_check_fail_force: str = "译文校验未通过"
    response_checker_fail_data: str = "数据结构错误"
    response_checker_fail_timeout: str = "网络请求超时"
    response_checker_fail_line_count: str = "行数不一致"
    response_checker_fail_degradation: str = "发生退化现象"
    response_checker_line_error_empty_line: str = "存在空行"
    response_checker_line_error_similarity: str = "较高相似度"
    project_store_ingesting_assets: str = "正在收纳资产 …"
    project_store_ingesting_file: str = "正在收纳资产：{NAME}"
    project_store_parsing_items: str = "正在解析翻译条目 …"
    project_store_created: str = "工程创建完成 …"
    project_store_file_not_found: str = "工程文件不存在: {PATH}"

    # 分析
    analysis_task_source_texts: str = "分析输入："
    analysis_task_extracted_terms: str = "提取术语："
    analysis_task_no_terms: str = "未提取到术语"

    # 工作台
    workbench_msg_file_exists: str = "文件已存在 …"
    workbench_msg_unsupported_format: str = "不支持的文件格式"
    workbench_msg_replace_name_conflict: str = "文件已存在 …"
    workbench_msg_file_not_found: str = "文件不存在 …"

    # 质量类通用
    quality_default_preset_loaded_message: str = "已自动加载默认预设：{NAME} …"

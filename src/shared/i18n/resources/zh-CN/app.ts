import { LANGUAGE_DISPLAY_NAMES } from "../../../../domain/language";

export const zh_cn_app = {
  aria: {
    toggle_navigation: "切换导航",
  },
  metadata: {
    app_name: "LinguaGacha",
  },
  action: {
    cancel: "取消",
    confirm: "确认",
    close: "关闭",
    reset: "重置",
    skip: "跳过",
    overwrite: "覆盖",
    replace: "替换",
    loading: "加载中",
    select_file: "选择文件",
    select_folder: "选择文件夹",
  },
  feedback: {
    save_success: "已保存 …",
    no_valid_data: "没有有效数据 …",
    update_failed: "更新失败 …",
    project_settings_aligned: "已按当前设置更新项目设置 …",
  },
  error_boundary: {
    eyebrow: "Renderer Runtime",
    title: "页面运行时发生异常",
    description: "当前窗口已切换到保护视图，异常详情已经写入日志。",
  },
  project_settings_alignment: {
    field: {
      source_language: "输入语言",
      target_language: "输出语言",
      mtool_optimizer_enable: "MTool 优化器",
      skip_duplicate_source_text_enable: "跳过重复原文",
    },
  },
  close_confirm: {
    description: "是否确认退出应用 …?",
  },
  quality_rule_import: {
    duplicate_description: "检测到 {COUNT} 条重复规则，请选择处理方式 …?",
  },
  update: {
    toast: "发现新版本，点击左下角更新入口下载新版本 …",
  },
  system_proxy: {
    startup_notice: "检查到系统代理设置 - {PROXY}",
  },
  drop: {
    multiple_unavailable: "一次只能拖拽一个文件",
    unavailable: "当前无法读取拖拽文件的本地路径，请换用点击导入。",
    import_here: "松手即可导入规则文件",
  },
  toggle: {
    disabled: "禁用",
    enabled: "启用",
  },
  drag: {
    enabled: "拖拽排序",
    disabled: "禁止拖拽",
  },
  language: Object.fromEntries(
    Object.entries(LANGUAGE_DISPLAY_NAMES).map(([code, names]) => [code, names.zh]),
  ) as Record<keyof typeof LANGUAGE_DISPLAY_NAMES, string>,
  navigation_action: {
    theme: "变换自如",
    switch_theme: "切换主题",
    toggle_lg_base_font: "切换字体",
    language: "字字珠玑",
    logs: "日志",
  },
  profile: {
    status: "Ciallo～(∠・ω< )⌒✮",
    status_tooltip: "打开 GitHub 项目主页",
    update_available: "点击下载新版本 …!",
    update_available_tooltip: "打开 GitHub Release 页面",
  },
  prompt: {
    builder_control_character_samples: "控制字符示例：",
    builder_glossary_header: "术语表 <术语原文> -> <术语译文> #<术语信息>:",
    builder_input: "输入：",
    builder_preceding_context: "参考上文：",
  },
  native_file_filter: {
    project: "LinguaGacha Project",
    supported_json_xlsx_files: "支持的文件 (*.json *.xlsx)",
    json_files: "JSON 文件 (*.json)",
    excel_files: "Excel 文件 (*.xlsx)",
    supported_txt_files: "支持的文件 (*.txt)",
  },
  error: {
    request: {
      validation_failed: {
        message: "请求参数无效 …",
      },
      invalid_json: {
        message: "请求 JSON 无效 …",
      },
      route_not_found: {
        message: "API 路由不存在 …",
      },
    },
    project: {
      not_loaded: {
        message: "工程未加载 …",
        action: "请先打开或创建工程 …",
      },
      not_found: {
        message: "工程文件不存在 …",
        action: "请确认工程文件仍在原位置 …",
      },
    },
    file: {
      not_found: {
        message: "文件不存在 …",
        action: "请确认文件仍在原位置 …",
      },
      unsupported_format: {
        message: "不支持的文件格式 …",
        action: "请选择 LinguaGacha 支持的源文件 …",
      },
      parse_failed: {
        message: "文件内容解析失败 …",
        action: "请确认文件内容完整，或换用原始未损坏的文件 …",
      },
      invalid_structure: {
        message: "文件结构不符合格式要求 …",
        action: "请确认文件来源正确，或重新导出后再导入 …",
      },
      io_failed: {
        message: "文件读写失败 …",
      },
    },
    database: {
      conflict: {
        message: "数据库写入冲突，请刷新后重试 …",
        action: "请刷新当前数据后再次提交 …",
      },
    },
    data: {
      revision_conflict: {
        message: "数据版本已变化，请刷新后重试 …",
        action: "请刷新当前数据后再次提交 …",
      },
    },
    task: {
      busy: {
        message: "后台任务正在执行中，请稍后再试 …",
        action: "请等待当前任务结束或先停止任务 …",
      },
    },
    model: {
      not_found: {
        message: "模型配置不存在 …",
        action: "请重新选择模型配置 …",
      },
      provider_failed: {
        message: "模型服务请求失败，请检查接口配置 …",
        action: "请检查模型地址、密钥和服务商状态 …",
      },
    },
    worker: {
      failed: {
        message: "后台执行通道失败 …",
      },
      execution_failed: {
        message: "后台任务执行失败 …",
      },
    },
    runtime: {
      capability_missing: {
        message: "当前运行环境缺少必要能力 …",
      },
      disposed: {
        message: "运行资源已释放 …",
      },
      cancelled: {
        message: "操作已取消 …",
      },
      internal_invariant: {
        message: "内部状态异常 …",
      },
    },
    language: {
      invalid_target_language: {
        message: "目标语言无效 …",
      },
      unsupported_all_target_language: {
        message: "目标语言不支持全部语言 …",
      },
      unknown_source_language_code: {
        message: "源语言代码无效 …",
      },
    },
    quality: {
      unknown_rule_type: {
        message: "质量规则类型无效 …",
      },
      unsupported_rule_meta: {
        message: "质量规则配置项无效 …",
      },
    },
    prompt: {
      unknown_prompt_type: {
        message: "提示词类型无效 …",
      },
    },
    desktop: {
      missing_core_api_base_url: {
        message: "Core API 地址未配置 …",
      },
      core_api_unavailable: {
        message: "Core API 不可用 …",
      },
      core_metadata_unavailable: {
        message: "Core 元信息不可用 …",
      },
      event_stream_failed: {
        message: "事件流连接失败 …",
      },
      http_error: {
        message: "请求失败：{PATH} …",
      },
      network_failed: {
        message: "网络请求失败：{PATH} …",
      },
      timeout: {
        message: "请求超时：{PATH} …",
      },
    },
  },
  diagnostic: {
    api_gateway: {
      direct_route_failed: "API Gateway 直接路由处理失败 …",
    },
    default_preset: {
      config_normalize_failed: "归一化默认预设配置失败：{CONFIG_PATH} …",
      prompt_load_failed: "默认提示词预设加载失败 …",
      quality_rule_load_failed: "默认质量规则预设加载失败 …",
      value_normalize_failed: "归一化默认预设值失败：{PRESET_DIRECTORY} -> {VALUE} …",
    },
    file_export: {
      open_output_folder_failed: "打开输出文件夹失败 …",
      translation_failed: "译文生成失败 …",
      write_file_failed: "文件写入失败 …",
    },
    lifecycle: {
      app_start_failed: "LinguaGacha 启动失败 …",
      core_gateway_start_failed: "Core / Gateway 启动失败 …",
      main_fatal_uncaught: "Electron main 捕获到未处理致命异常 …",
    },
    migration: {
      path_failed: "迁移路径失败：{SOURCE_PATH} -> {DESTINATION_PATH} …",
    },
    renderer: {
      main_frame_load_failed: "渲染层主框架加载失败 …",
      process_exited: "渲染进程已退出 …",
      reported_error: "Renderer 捕获到前端运行时异常 …",
      subframe_load_failed: "渲染层子框架加载失败 …",
      window_unresponsive: "窗口失去响应 …",
    },
  },
  log: {
    analysis_task_no_terms: "未提取到术语",
    analysis_task_result: "分析结果：",
    analysis_task_source_texts: "分析输入：",
    api_gateway_started: "API Gateway 已启动 - {BASE_URL}",
    api_test_fail: "接口测试失败 …",
    api_test_key: "正在测试密钥：",
    api_test_messages: "任务提示词：",
    api_test_result: "共测试 {COUNT} 个接口，成功 {SUCCESS} 个，失败 {FAILURE} 个 …",
    api_test_result_failure: "失败的密钥：",
    api_test_response_result: "模型回复内容：",
    api_test_timeout: "请求超时（{SECONDS} 秒）",
    api_test_token_info: "任务耗时 {TIME} 秒，输入消耗 {PT} Tokens，输出消耗 {CT} Tokens",
    app_version: "LinguaGacha v{VERSION} …",
    system_proxy_startup_detected: "检查到系统代理设置 - {PROXY}",
    default_preset_loaded: "已自动加载默认预设：{NAMES} …",
    engine_api_model: "接口模型",
    engine_api_name: "接口名称",
    engine_api_url: "接口地址",
    engine_task_done: "任务已完成 …",
    engine_task_exception: "任务执行失败 …",
    engine_task_fail: "任务未能全部完成，仍有部分数据未处理，请检查处理结果 …",
    engine_task_rule_analysis: "规则分析：",
    engine_task_thinking_process: "思考过程：",
    engine_task_stop: "任务已停止 …",
    engine_task_success:
      "任务耗时 {TIME} 秒，文本行数 {LINES} 行，输入消耗 {PT} Tokens，输出消耗 {CT} Tokens",
    generate_translation_done: "译文已保存至 {PATH} …",
    generate_translation_start: "生成译文中 …",
    response_checker_fail_data: "数据结构错误",
    response_checker_fail_degradation: "发生退化现象",
    response_checker_fail_line_count: "行数不一致",
    response_checker_fail_request: "模型请求失败",
    request_failed_retry: "模型请求失败，将自动重试 …",
    response_checker_fail_timeout: "网络请求超时",
    response_checker_line_error_empty_line: "存在空行",
    response_checker_line_error_hangeul: "谚文残留",
    response_checker_line_error_kana: "假名残留",
    response_checker_line_error_similarity: "较高相似度",
    system_closed_dropped: "日志系统已关闭，丢弃新日志：{MESSAGE}",
    translation_response_check_fail: "返回数据错误，将自动重试，原因：{REASON}",
    translation_response_check_fail_all: "全部译文质量校验失败，将自动切分重试，原因：{REASON}",
    translation_response_check_fail_part: "部分译文质量校验失败，将自动切分重试，原因：{REASON}",
    translation_task_result: "翻译结果：",
    translation_task_status_info:
      "拆分次数：{SPLIT} | 单条重试次数：{RETRY} | 任务长度阈值：{THRESHOLD}",
  },
} as const;

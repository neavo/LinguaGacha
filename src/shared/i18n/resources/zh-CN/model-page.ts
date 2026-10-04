export const zh_cn_model_page = {
  auth: {
    open_login_page: "使用默认浏览器打开登录页",
    copy_link: "复制链接",
    copied: "已复制",
    success: "点击登录 …",
    login: "点击登录",
    logout: "退出登录",
  },
  title: "模型管理",
  category: {
    preset: {
      description: "应用内置的预设模型",
    },
    custom_google: {
      description: "兼容 Google Gemini API 格式的自定义模型",
    },
    custom_openai: {
      description: "兼容 OpenAI API 格式的自定义模型",
    },
    custom_openai_responses: {
      description: "兼容 OpenAI Responses API 格式的自定义模型",
    },
    custom_anthropic: {
      description: "兼容 Anthropic Claude API 格式的自定义模型",
    },
  },
  copy_name: "{NAME}_副本",
  action: {
    reset: "重置模型",
    delete: "删除模型",
    copy: "生成副本",
    basic_settings: "基础设置",
    task_settings: "任务设置",
    advanced_settings: "高级设置",
    input: "输入",
    fetch: "获取",
    test: "测试",
  },
  dialog: {
    selector: {
      loading: "正在获取模型列表 …",
      search_placeholder: "筛选模型 …",
      empty: "没有有效数据 …",
    },
  },
  confirm: {
    logout: { description: "是否确认退出登录 …？" },
    delete: {
      description: "是否确认删除模型 …?",
    },
    reset: {
      description: "是否确认重置模型 …?",
    },
  },
  feedback: {
    copy_success: "模型已复制\n分组：{CATEGORY}\n名称：{NAME}",
    delete_last_one: "每个分类至少需要保留一个模型，无法删除 …",
    agent_limits_adjusted: "设置值非法，已为您自动调整为可用配置 …",
    json_format_error: "JSON 格式错误，请输入有效的 JSON 对象 …",
    test_failed: "模型测试失败 …",
  },
  fields: {
    speed: {
      ultrafast: "UltraFast",
      default_description: "不指定速度等级，遵循平台的默认设置",
      title: "速度等级",
      description: "设置模型的速度等级，实际是否生效由供应商决定，生效时会产生额外费用",
      standard: "标准",
      fast: "快速",
      default: "保持默认",
    },
    context_window: {
      title: "上下文窗口",
      description: "仅对 AGENT 任务生效，0 = 自动",
    },
    max_output_tokens: {
      title: "最大输出长度",
      description: "仅对 AGENT 任务生效，0 = 自动",
    },
    name: {
      title: "模型名称",
      description: "请输入模型名称，仅用于应用内显示，无实际作用",
      placeholder: "请输入模型名称 …",
    },
    api_url: {
      title: "接口地址",
      description: "请输入接口地址，请注意辨别结尾是否需要添加 /v1",
      placeholder: "请输入接口地址 …",
    },
    api_key: {
      title: "接口密钥",
      description:
        "请输入接口密钥，例如 sk-d0daba12345678fd8eb7b8d31c123456，填入多个密钥可以轮询使用，每行一个",
      placeholder: "请输入接口密钥 …",
    },
    model_id: {
      title: "模型标识",
      description: "当前使用的模型标识为 {MODEL}",
      placeholder: "请输入模型标识 …",
    },
    thinking: {
      title: "思考等级",
      description: "设置模型的思考行为，会影响思考的时间和消耗",
    },
    input_token_limit: {
      title: "输入 Token 限制",
      description: "每个任务输入文本的最大 Token 数量",
    },
    output_token_limit: {
      title: "输出 Token 限制",
      description: "每个任务输出文本的最大 Token 数量，0 = 自动",
    },
    rpm_limit: {
      title: "每分钟请求数限制 (RPM)",
      description: "限制该模型每分钟允许发起的请求数量，0 = 自动",
    },
    concurrency_limit: {
      title: "并发任务数限制",
      description: "限制该模型同时执行的任务数，0 = 自动",
    },
    top_p: {
      title: "top_p",
      description: "请谨慎设置，错误的值可能导致结果异常或者请求报错",
    },
    temperature: {
      title: "temperature",
      description: "请谨慎设置，错误的值可能导致结果异常或者请求报错",
    },
    extra_headers: {
      title: "自定义请求头",
      description: "自定义请求头参数，请谨慎设置，错误的值可能导致结果异常或者请求报错",
      placeholder: '例如：{"Authorization": "Bearer xxx"}',
    },
    extra_body: {
      title: "自定义请求体",
      description: "自定义请求体参数，请谨慎设置，错误的值可能导致结果异常或者请求报错",
      placeholder: '例如：{"seed": 42}',
    },
  },
} as const;

export const zh_cn_model_page = {
  title: '模型管理',
  category: {
    preset: {
      title: '预设模型',
      description: '应用内置的预设模型',
    },
    custom_google: {
      title: '自定义 Google 模型',
      description: '兼容 Google Gemini API 格式的自定义模型',
    },
    custom_openai: {
      title: '自定义 OpenAI 模型',
      description: '兼容 OpenAI API 格式的自定义模型',
    },
    custom_anthropic: {
      title: '自定义 Anthropic 模型',
      description: '兼容 Anthropic Claude API 格式的自定义模型',
    },
  },
  action: {
    activate: '激活',
    basic_settings: '基础设置',
    task_settings: '任务设置',
    advanced_settings: '高级设置',
    delete: '删除',
    reset: '重置',
    add: '新增',
    input: '输入',
    fetch: '获取',
    test: '测试',
  },
  dialog: {
    selector: {
      loading: '正在获取模型列表 …',
      search_placeholder: '筛选模型 …',
      empty: '没有找到匹配的模型 …',
    },
    model_id_input: {
      confirm: '确认',
    },
  },
  confirm: {
    delete: {
      title: '确认',
      description: '确认删除数据 …？',
    },
    reset: {
      title: '确认',
      description: '确认重置数据 …？',
    },
  },
  feedback: {
    refresh_failed: '模型快照刷新失败，请稍后再试 …',
    add_failed: '新增模型失败，请稍后再试 …',
    update_failed: '模型配置保存失败，请稍后再试 …',
    reorder_failed: '模型顺序保存失败，请稍后再试 …',
    delete_last_one: '每个分类至少需要保留一个模型，无法删除 …',
    reset_success: '模型已重置 …',
    json_format_error: 'JSON 格式错误，请输入有效的 JSON 对象 …',
    selector_load_failed: '获取模型列表失败，请检查接口配置 …',
    test_failed: '模型测试失败，请稍后再试 …',
  },
  fields: {
    name: {
      title: '模型名称',
      description: '请输入模型名称，仅用于应用内显示，无实际作用',
      placeholder: '请输入模型名称 …',
    },
    api_url: {
      title: '接口地址',
      description: '请输入接口地址，请注意辨别结尾是否需要添加 /v1',
      placeholder: '请输入接口地址 …',
    },
    api_key: {
      title: '接口密钥',
      description: '请输入接口密钥，例如 sk-d0daba12345678fd8eb7b8d31c123456，填入多个密钥可以轮询使用，每行一个',
      placeholder: '请输入接口密钥 …',
    },
    model_id: {
      title: '模型标识',
      description: '当前使用的模型标识为 {MODEL}',
      placeholder: '请输入模型标识 …',
    },
    thinking: {
      title: '思考等级',
      description: '设置模型的思考行为，会影响思考的时间和消耗，点击问号图标查看支持的模型列表',
      help_label: '查看思考等级支持说明',
    },
    input_token_limit: {
      title: '输入 Token 限制',
      description: '每个任务输入文本的最大 Token 数量',
    },
    output_token_limit: {
      title: '输出 Token 限制',
      description: '每个任务输出文本的最大 Token 数量，0 = 自动',
    },
    rpm_limit: {
      title: '每分钟请求数限制 (RPM)',
      description: '限制该模型每分钟允许发起的请求数量，0 = 自动',
    },
    concurrency_limit: {
      title: '并发任务数限制',
      description: '限制该模型同时执行的任务数，0 = 自动',
    },
    top_p: {
      title: 'top_p',
      description: '请谨慎设置，错误的值可能导致结果异常或者请求报错',
    },
    temperature: {
      title: 'temperature',
      description: '请谨慎设置，错误的值可能导致结果异常或者请求报错',
    },
    presence_penalty: {
      title: 'presence_penalty',
      description: '请谨慎设置，错误的值可能导致结果异常或者请求报错',
    },
    frequency_penalty: {
      title: 'frequency_penalty',
      description: '请谨慎设置，错误的值可能导致结果异常或者请求报错',
    },
    extra_headers: {
      title: '自定义请求头',
      description: '自定义请求头参数，请谨慎设置，错误的值可能导致结果异常或者请求报错',
      placeholder: '例如：{"Authorization": "Bearer xxx"}',
    },
    extra_body: {
      title: '自定义请求体',
      description: '自定义请求体参数，请谨慎设置，错误的值可能导致结果异常或者请求报错',
      placeholder: '例如：{"seed": 42}',
    },
  },
  thinking_level: {
    off: '无',
    low: '低',
    medium: '中',
    high: '高',
  },
} as const

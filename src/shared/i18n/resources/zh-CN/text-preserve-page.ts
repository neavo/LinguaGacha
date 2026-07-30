export const zh_cn_text_preserve_page = {
  title: "文本保护",

  mode: {
    label: "文本保护模式",

    loading_toast: "正在刷新校对缓存 …",
    content_html:
      "对文本中无需翻译的代码段、控制字符、样式字符等内容进行保护，避免它们被错误的翻译" +
      "<br>" +
      "• 关闭 - 不使用任何保护规则，完全交给 AI 执行判断处理" +
      "<br>" +
      "• 智能 - 自动判断文本格式与游戏引擎选择合适的保护规则" +
      "<br>" +
      "• 自定义 - 根据本页中设置的 <font color='darkgoldenrod'><b>正则规则</b></font> 匹配对应的文本进行保护",
    options: {
      off: "关闭",
      smart: "智能",
      custom: "自定义",
    },
  },
  fields: {
    note: "备注（仅作备忘，无实际作用）",
    statistics: "状态",
  },
  filter: {
    scope: {
      rule: "规则",
      note: "备注",
    },
  },

  preset: {
    dialog: {
      name_placeholder: "请输入预设名称 …",
    },
  },
  statistics: {
    hit_count: "命中条目数：{COUNT}",

    action: {
      search_relation: "查询包含关系",
    },
  },

  feedback: {
    preset_name_required: "预设名称不能为空",

    default_preset_cleared: "已取消默认预设 …",
    unknown_error: "当前操作失败，请稍后重试。",

    reset_success: "已重置 …",
    mode_refresh_pending: "文本保护模式已切换，校对缓存仍在刷新，请稍后再看结果。",
  },
} as const;

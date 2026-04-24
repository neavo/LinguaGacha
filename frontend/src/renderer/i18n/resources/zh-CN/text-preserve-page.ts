export const zh_cn_text_preserve_page = {
  title: "文本保护",
  action: {
    create: "新增",
    edit: "编辑",
    delete: "删除",
    save: "保存",
    cancel: "取消",
    import: "导入",
    export: "导出",
    statistics: "统计",
    preset: "预设",
    query: "查询",
  },
  mode: {
    label: "文本保护模式",
    status: "{TITLE} - {STATE}",
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
    drag: "拖拽",
    rule: "规则",
    note: "备注（仅作备忘，无实际作用）",
    statistics: "状态",
  },
  filter: {
    placeholder: "查询 …",
    clear: "清空",
    regex: "正则",
    regex_tooltip_label: "正则模式",
    scope: {
      label: "范围",
      tooltip_label: "搜索范围",
      all: "全部",
      rule: "规则",
      note: "备注",
    },
  },
  sort: {
    ascending: "正序",
    descending: "反序",
    clear: "取消",
  },
  dialog: {
    create_title: "新增文本保护规则",
    edit_title: "编辑文本保护规则",
  },
  preset: {
    save: "保存预设",
    apply: "导入",
    rename: "重命名",
    delete: "删除预设",
    set_default: "设为默认预设",
    cancel_default: "取消默认预设",
    dialog: {
      save_title: "保存为预设",
      save_confirm: "保存",
      rename_title: "重命名预设",
      rename_confirm: "重命名",
      name_placeholder: "请输入预设名称 …",
    },
  },
  statistics: {
    hit_count: "命中条目数：{COUNT}",
    subset_relations: "存在包含关系：",
    relation_line: "{CHILD} -> {PARENT}",
    running: "统计中",
    action: {
      search_relation: "查询包含关系",
    },
  },
  confirm: {
    delete_selection: {
      description: "是否确认删除 {COUNT} 条记录 …?",
    },
    delete_preset: {
      description: "是否确认删除预设“{NAME}” …?",
    },
    reset: {
      description: "是否确认重置数据 …?",
    },
    overwrite_preset: {
      description: "是否确认覆盖预设“{NAME}” …?",
    },
  },
  feedback: {
    import_success: "数据已导入 …",
    export_success: "数据已导出 …",
    preset_saved: "预设已保存 …",
    preset_renamed: "预设已重命名 …",
    preset_deleted: "预设已删除 …",
    preset_name_required: "预设名称不能为空",
    preset_exists: "文件已存在 …",
    default_preset_set: "已设置为默认预设 …",
    default_preset_cleared: "已取消默认预设 …",
    unknown_error: "当前操作失败，请稍后重试。",
    regex_invalid: "正则表达式无效",
    merge_warning: "已合并重复条目 …",
    reset_success: "已重置 …",
    mode_refresh_pending: "文本保护模式已切换，校对缓存仍在刷新，请稍后再看结果。",
  },
} as const;

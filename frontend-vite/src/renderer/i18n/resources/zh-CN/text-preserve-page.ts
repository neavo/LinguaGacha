export const zh_cn_text_preserve_page = {
  title: '文本保护',
  summary: '文本保护页会约束不可翻译片段，守住格式与专有内容。',
  action: {
    create: '新增',
    edit: '编辑',
    delete: '删除',
    save: '保存',
    cancel: '取消',
    import: '导入',
    export: '导出',
    statistics: '统计',
    preset: '预设',
    query: '查询',
  },
  mode: {
    label: '文本保护模式',
    status: '{TITLE} - {STATE}',
    content_html:
      '对文本中无需翻译的代码段、控制字符、样式字符等内容进行保护，避免它们被错误的翻译'
      + '<br>'
      + '• 关闭 - 不使用任何保护规则，完全交给 AI 执行判断处理'
      + '<br>'
      + '• 智能 - 自动判断文本格式与游戏引擎选择合适的保护规则'
      + '<br>'
      + "• 自定义 - 根据本页中设置的 <font color='darkgoldenrod'><b>正则规则</b></font> 匹配对应的文本进行保护",
    options: {
      off: '关闭',
      smart: '智能',
      custom: '自定义',
    },
  },
  fields: {
    drag: '拖拽',
    rule: '规则',
    note: '备注（仅作备忘，无实际作用）',
    statistics: '状态',
  },
  filter: {
    placeholder: '请输入关键字 …',
    clear: '清空',
    regex: '正则',
    regex_tooltip_label: '正则模式',
    scope: {
      label: '范围',
      tooltip_label: '搜索范围',
      all: '全部',
      rule: '规则',
      note: '备注',
    },
  },
  sort: {
    ascending: '正序',
    descending: '反序',
    clear: '取消',
  },
  dialog: {
    create_title: '新增文本保护规则',
    edit_title: '编辑文本保护规则',
  },
  preset: {
    save: '保存预设',
    apply: '导入',
    rename: '重命名',
    delete: '删除预设',
    set_default: '设为默认预设',
    cancel_default: '取消默认预设',
    dialog: {
      save_title: '保存为预设',
      save_description: '将当前文本保护规则保存为用户预设，便于后续快速导入。',
      save_confirm: '保存',
      rename_title: '重命名预设',
      rename_description: '修改这个用户预设的名称。',
      rename_confirm: '重命名',
      name_placeholder: '请输入预设名称 …',
    },
  },
  statistics: {
    hit_count: '命中条目数：{COUNT}',
    subset_relations: '存在包含关系：',
    relation_line: '{CHILD} -> {PARENT}',
    running: '统计中',
    action: {
      search_relation: '查询包含关系',
    },
  },
  confirm: {
    delete_selection: {
      title: '确认删除',
      description: '是否确认删除 {COUNT} 条记录？',
      confirm: '确认删除',
    },
    delete_preset: {
      title: '删除预设',
      description: '是否确认删除预设“{NAME}”？',
      confirm: '删除预设',
    },
    reset: {
      title: '确认重置',
      description: '是否确认重置数据 …?',
      confirm: '重置',
    },
    overwrite_preset: {
      title: '覆盖预设',
      description: '预设“{NAME}”已存在，是否确认覆盖 …?',
      confirm: '覆盖',
    },
  },
  feedback: {
    import_success: '数据已导入 …',
    export_success: '数据已导出 …',
    preset_saved: '预设已保存 …',
    preset_renamed: '预设已重命名 …',
    preset_deleted: '预设已删除 …',
    preset_name_required: '预设名称不能为空',
    preset_exists: '文件已存在 …',
    default_preset_set: '已设置为默认预设 …',
    default_preset_cleared: '已取消默认预设 …',
    unknown_error: '当前操作失败，请稍后重试。',
    regex_invalid: '正则表达式无效',
    merge_warning: '已合并重复条目 …',
    reset_success: '已重置 …',
  },
} as const

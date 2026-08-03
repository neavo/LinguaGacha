export const zh_cn_quality_editor = {
  action: {
    cancel: "取消",
    create: "新增",
    delete: "删除",
    edit: "编辑",
    export: "导出",
    import: "导入",
    preset: "预设",
    query: "查询",
    save: "保存",
  },
  confirm: {
    delete_preset: {
      description: "是否确认删除预设 …?",
    },
    delete_selection: {
      description: "是否确认删除 {COUNT} 条记录 …?",
    },
    overwrite_preset: {
      description: "是否确认覆盖预设 …?",
    },
    reset: {
      description: "是否确认重置数据 …?",
    },
  },
  feedback: {
    default_preset_cleared: "已取消默认预设 …",
    default_preset_set: "已设置为默认预设 …",
    export_success: "数据已导出 …",
    import_success: "数据已导入 …",
    preset_deleted: "预设已删除 …",
    preset_exists: "文件已存在 …",
    preset_name_required: "预设名称不能为空",
    preset_renamed: "预设已重命名 …",
    preset_saved: "预设已保存 …",
    regex_invalid: "正则表达式无效",
    reset_success: "已重置 …",
    source_required: "原文不能为空",
  },
  fields: {
    drag: "拖拽",
    rule: "规则",
    source: "原文",
  },
  filter: {
    clear: "清空",
    placeholder: "查询 …",
    regex: "正则",
    regex_tooltip_label: "正则模式",
    scope: {
      all: "全部",
      label: "范围",
      source: "原文",
      tooltip_label: "搜索范围",
    },
  },
  preset: {
    apply: "导入",
    cancel_default: "取消默认预设",
    delete: "删除预设",
    dialog: {
      name_placeholder: "请输入预设名称 …",
      rename_confirm: "重命名",
      save_confirm: "保存",
    },
    rename: "重命名",
    save: "保存预设",
    set_default: "设为默认预设",
  },
  sort: {
    ascending: "正序",
    clear: "取消",
    descending: "反序",
  },
  hit: {
    hit_count: "命中条目数：{COUNT}",
    relation_line: "{CHILD} -> {PARENT}",
    subset_relations: "存在包含关系：",
  },
  toggle: {
    status: "{TITLE} - {STATE}",
  },
} as const;

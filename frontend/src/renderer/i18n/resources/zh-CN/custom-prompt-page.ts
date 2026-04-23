export const zh_cn_custom_prompt_page = {
  title: '自定义提示词',
  action: {
    import: '导入',
    export: '导出',
    save: '保存',
    preset: '预设',
  },
  toggle: {
    status: '{TITLE} - {STATE}',
  },
  section: {
    prefix_label: '固定前缀',
    suffix_label: '固定后缀',
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
      save_confirm: '保存',
      rename_title: '重命名预设',
      rename_confirm: '重命名',
      name_placeholder: '请输入预设名称 …',
    },
  },
  confirm: {
    delete_preset: {
      title: '删除预设',
      description: '是否确认删除预设“{NAME}”？',
    },
    reset: {
      title: '确认重置',
      description: '是否确认重置数据 …?',
    },
    overwrite_preset: {
      title: '覆盖预设',
      description: '预设“{NAME}”已存在，是否确认覆盖 …?',
    },
  },
  feedback: {
    load_failed: '任务执行失败 …',
    save_failed: '任务执行失败 …',
    import_failed: '任务执行失败 …',
    import_success: '数据已导入 …',
    export_failed: '任务执行失败 …',
    export_success: '数据已导出 …',
    preset_failed: '任务执行失败 …',
    preset_saved: '预设已保存 …',
    preset_renamed: '任务执行成功 …',
    preset_deleted: '任务执行成功 …',
    preset_name_required: '预设名称不能为空',
    preset_exists: '文件已存在 …',
    default_preset_set: '已设置为默认预设 …',
    default_preset_cleared: '已取消默认预设 …',
    reset_success: '已重置 …',
  },
} as const

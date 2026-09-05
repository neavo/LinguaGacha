export const zh_cn_custom_prompt_page = {
  save: {
    saved: "已保存",
    pending: "待保存",
    saving: "保存中",
    error: "保存失败",
    discard: "撤销未保存改动",
    waiting: "当前任务运行中，请稍后保存。",
  },
  title: "自定义提示词",

  section: {
    prefix_label: "固定前缀",
    suffix_label: "固定后缀",
  },

  confirm: {
    reset: {
      description: "是否确认重置数据 …?",
    },
  },
  feedback: {
    load_failed: "提示词加载失败，请重试。",
    save_failed: "提示词保存失败，编辑内容已保留。",
    import_failed: "任务执行失败 …",
    export_failed: "任务执行失败 …",
    preset_failed: "任务执行失败 …",
    preset_succeeded: "任务执行成功 …",
  },
} as const;

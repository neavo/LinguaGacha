export const zh_cn_custom_prompt_page = {
  save: {
    discard: "撤销未保存改动",
    waiting: "当前任务运行中，请稍后保存。",
  },
  title: "自定义提示词",

  header: {
    description_html: "通过自定义提示词追加故事设定、行文风格等额外翻译要求",
  },

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
  },
} as const;

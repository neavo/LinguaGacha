export const zh_cn_workbench_page = {
  title: "工作台",
  unit: {
    line: "Line",
  },
  table: {
    file_name: "文件名",
    progress: "进度",
    agent: "AGENT",
    agent_only: "此文件仅能使用 AGENT 翻译",
    actions: "操作",
  },
  feedback: {
    add_file_loading_toast: "正在添加文件并刷新缓存 …",
    no_valid_file: "没有可添加的有效文件",
    close_project_failed: "关闭工程失败 …",
  },
  action: {
    add_file: "添加",
    generate_translation: "生成译文",
    close_project: "关闭工程",
    reset: "重置翻译状态",
    translation_task: "翻译",
    start_translation: "开始翻译",
    reset_task_all: "重置所有数据",
    reset_task_failed: "重置失败数据",
  },
  translation_export: {
    checking: "正在检查校对警告 …",
    check_failed: "读取校对警告失败，仍可继续生成当前译文 …",
    warning_description:
      "检查到 {COUNT} 个校对警告，推荐使用 AGENT 自动审校后再生成译文，是否确认继续 …?",
    warning_list: "校对警告",
    retry_check: "重新检查",
    continue_generate: "继续生成",
  },
  dialog: {
    import_conflict: {
      description: "检测到 {COUNT} 个同名文件，请选择处理方式 …",
    },
    inherit_import: {
      description: "是否使用当前工程中已完成的翻译文本填充新文件 …?",
      fill: "填充",
      do_not_fill: "不填充",
    },
    reset: {
      description: "是否确认重置该文件的翻译状态 …?",
    },
    delete: {
      description: "是否确认删除所选文件及其所有翻译条目 …?",
    },
    close_project: {
      description: "是否确认关闭当前工程 …?",
    },
  },
} as const;

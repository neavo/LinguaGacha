export const zh_cn_workbench_page = {
  title: "工作台",
  unit: {
    line: "Line",
  },
  table: {
    file_name: "文件名",
    progress: "进度",
    agent: "AGENT",
    agent_only: "仅能使用 AGENT 翻译",
    agent_recommended: "建议使用 AGENT 翻译",
  },
  feedback: {
    no_valid_file: "没有可添加的有效文件",
    close_project_failed: "关闭工程失败 …",
  },
  action: {
    add_file: "添加",
    close_project: "关闭工程",
    reset: "重置文件数据",
    translation_task: "翻译",
    start_translation: "开始翻译",
    reset_task_all: "重置所有数据",
    reset_task_failed: "重置失败数据",
  },
  dialog: {
    import_conflict: {
      description: "检测到 {COUNT} 个同名文件，请选择处理方式 …",
    },
    inherit_import: {
      description: "是否使用已完成的译文填充导入的文件 …?",
      fill: "填充",
      do_not_fill: "不填充",
    },
    reset: {
      description: "是否确认重置所选文件及其所有翻译条目 …?",
    },
    delete: {
      description: "是否确认删除所选文件及其所有翻译条目 …?",
    },
    close_project: {
      description: "是否确认关闭当前工程 …?",
    },
  },
} as const;

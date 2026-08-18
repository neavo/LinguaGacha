export const zh_cn_workbench_page = {
  title: "工作台",
  unit: {
    line: "Line",
  },
  table: {
    file_name: "文件名",
    line_count: "行数",
    actions: "操作",
  },
  sort: {
    ascending: "按升序排序",
    descending: "按降序排序",
    clear: "清除排序",
  },
  feedback: {
    refresh_failed: "工作台刷新失败",
    add_file_loading_toast: "正在添加文件并刷新缓存 …",
    no_valid_file: "没有可添加的有效文件。",
    file_action_failed: "文件操作失败，请稍后重试。",
    generate_translation_failed: "生成当前可用译文失败，请稍后重试。",
    close_project_failed: "关闭工程失败，请稍后重试。",
  },
  action: {
    add_file: "添加",
    generate_translation: "生成译文",
    close_project: "关闭项目",
    reset: "重置翻译状态",
    translation_task: "翻译",
    start_translation: "开始翻译",
    reset_task_all: "重置所有数据",
    reset_task_failed: "重置失败数据",
    stop_task: "停止",
    analysis_task: "分析",
    start_analysis: "开始分析",
    import_analysis_glossary: "导入候选术语",
  },
  task: {
    menu: {
      progress: "进度",
    },
    summary: {
      empty: "无任务",
      stopping: "停止中",
      detail_tooltip: "点击查看详情",
    },
    detail: {
      elapsed_time: "累计时间",
      remaining_time: "剩余时间",
      average_speed: "平均速度",
      input_tokens: "输入 Token",
      output_tokens: "输出 Token",
    },
    feedback: {
      done: "已完成 …",
      stopped: "已停止 …",
    },
  },
  analysis_task: {
    menu: {
      tooltip: "从原文中提取术语",
    },
    migration: {
      description: "经典分析任务流程即将移除 …\n推荐使用 AGENT 全自动生成术语表，更快更智能 …!",
      jump: "点击跳转",
      continue: "继续任务",
    },
    summary: {
      running: "分析中",
    },
    detail: {
      title: "分析详情",
      description: "查看当前分析的实时统计。",
      waveform_title: "实时速度",
      metrics_title: "统计信息",

      active_requests: "实时任务数",
      candidate_count: "候选术语",
    },
    confirm: {
      reset_all_description: "是否确认重置整个项目的分析进度 …?",
      reset_failed_description: "是否确认重置失败的分析进度 …?",
      import_glossary_description: "是否确认将候选术语导入术语表 …?",
      stop_description: "是否确认停止当前分析任务 …?",
    },
    feedback: {
      refresh_failed: "分析任务状态刷新失败",
      start_failed: "启动分析任务失败",
      stop_failed: "停止分析任务失败",

      reset_all_failed: "重置全部分析失败",
      reset_failed_failed: "重置失败分析进度失败",
      import_loading_toast: "正在导入候选术语并刷新校对缓存 …",
      import_failed: "导入候选术语失败",
      import_success: "已导入 {COUNT} 条候选术语",
      agent_draft_preserved: "AGENT 中已有草稿，已保留原内容。",
    },
  },
  translation_task: {
    menu: {
      tooltip: "将原文翻译为目标语言",
    },
    summary: {
      running: "翻译中",
    },
    detail: {
      title: "翻译详情",
      description: "查看当前翻译的实时统计。",
      waveform_title: "实时速度",
      metrics_title: "统计信息",

      active_requests: "实时任务数",
    },
    confirm: {
      reset_all_description: "是否确认重置整个项目的翻译进度 …?",
      reset_failed_description: "是否确认重置失败的翻译条目 …?",
      generate_description: "是否确认生成当前可用译文 …?",
      stop_description: "是否确认停止当前翻译任务 …?",
    },
    feedback: {
      refresh_failed: "翻译任务状态刷新失败",
      start_failed: "启动翻译任务失败",
      stop_failed: "停止翻译任务失败",

      reset_all_failed: "重置全部翻译失败",
      reset_failed_failed: "重置失败条目失败",
      generate_failed: "生成当前可用译文失败",
    },
  },
  reorder: {
    failed: "文件顺序保存失败，请稍后再试。",
  },
  dialog: {
    import_conflict: {
      description: "检测到 {COUNT} 个同名文件，请选择处理方式 …?",
    },
    inherit_import: {
      description: "是否使用当前项目中已完成的翻译文本填充新文件 …?",
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

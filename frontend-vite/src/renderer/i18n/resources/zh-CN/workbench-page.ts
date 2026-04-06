export const zh_cn_workbench_page = {
  title: '工作台',
  summary: '工作台会汇总文件列表、处理进度与工程级快捷操作。',
  section: {
    stats: '工作台统计',
    file_list: '文件列表',
    command_bar: '工作台命令栏',
  },
  unit: {
    file: 'File',
    line: 'Line',
  },
  stats: {
    file_count: '文件总数',
    total_lines: '总行数',
    translated: '已翻译',
    untranslated: '未翻译',
  },
  table: {
    drag_handle: '拖拽',
    drag_handle_aria: '拖拽排序',
    file_name: '文件名',
    format: '格式',
    line_count: '行数',
    actions: '操作',
    open_actions: '打开操作菜单',
  },
  action: {
    add_file: '添加文件',
    export_translation: '生成译文',
    close_project: '关闭项目',
    replace: '替换文件',
    reset: '重置翻译状态',
    delete: '删除',
  },
  format: {
    markdown: 'Markdown',
    text_file: '纯文本',
    subtitle_file: '字幕文件',
    ebook: '电子书',
    translation_export: '导出译文',
  },
  command: {
    description: '工作台底栏会承接工程级快捷操作。',
  },
  reorder: {
    failed: '文件顺序保存失败，请稍后再试。',
  },
  dialog: {
    replace: {
      title: '确认替换文件',
      description: '替换后会用新文件内容覆盖当前文件，并在刷新后尽量保持选中状态。',
      confirm: '确认替换',
    },
    reset: {
      title: '确认重置文件',
      description: '重置后会恢复该文件的初始工程内容，并重新计算统计数据。',
      confirm: '确认重置',
    },
    delete: {
      title: '确认删除文件',
      description: '删除后会把该文件从当前工程移除，并在刷新后更新统计卡片。',
      confirm: '确认删除',
    },
    export: {
      title: '确认生成译文',
      description: '生成后会按当前工程设置导出真实译文文件。',
      confirm: '确认生成',
    },
    close_project: {
      title: '确认关闭项目',
      description: '关闭后会卸载当前工程，并返回工程主页。',
      confirm: '确认关闭',
    },
  },
  empty: {
    title: '项目未加载',
    description: '请先加载工程后再管理文件、导出译文或关闭项目。',
    loaded_title: '还没有导入文件',
    loaded_description: '先从下方命令栏添加文件，工作台就会在这里展示可排序的文件列表。',
  },
} as const

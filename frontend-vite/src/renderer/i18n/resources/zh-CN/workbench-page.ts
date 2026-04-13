export const zh_cn_workbench_page = {
  title: '工作台',
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
  sort: {
    ascending: '按升序排序',
    descending: '按降序排序',
    clear: '清除排序',
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
    renpy: 'RenPy',
    mtool: 'MTool',
    sextractor: 'VNT/SExtractor',
    trans_project: 'Translator++',
    text_file: '纯文本',
    subtitle_file: '字幕文件',
    ebook: 'EPUB',
    translation_export: 'Translator++ XLSX',
    wolf: 'WOLF 官方工具 XLSX',
  },
  command: {
    description: '工作台底栏会承接工程级快捷操作。',
  },
  reorder: {
    failed: '文件顺序保存失败，请稍后再试。',
  },
  dialog: {
    replace: {
      title: '确认',
      description: '当前文件的翻译数据将尽可能的保留',
      confirm: '确认',
    },
    reset: {
      title: '确认',
      description: '确定要重置该文件的翻译状态吗 …?',
      confirm: '确认',
    },
    delete: {
      title: '确认',
      description: '确定要删除该文件及其所有翻译条目吗 …?',
      confirm: '确认',
    },
    export: {
      title: '确认',
      description: '确定要生成译文文件吗 …?',
      confirm: '确认',
    },
    close_project: {
      title: '确认',
      description: '确定要关闭当前工程吗 …?',
      confirm: '确认',
    },
  },
} as const

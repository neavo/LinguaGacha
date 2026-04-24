export const zh_cn_name_field_extraction_page = {
  title: "姓名字段提取",
  summary: {
    description:
      "提取 RenPy 和 GalGame 游戏文本中的角色姓名字段数据，自动生成对应的术语表数据，方便后续进行翻译。",
    emphasis: "支持 name_src 字符串与数组字段，并会按最长原文保留上下文。",
  },
  fields: {
    drag: "拖拽",
    source: "原文",
    translation: "译文",
    context: "上下文",
  },
  status: {
    translating: "翻译中",
  },
  action: {
    extract: "提取",
    extracting: "提取中",
    translate: "翻译",
    translating: "翻译中",
    import_glossary: "导入到术语表",
    edit: "编辑",
    save: "保存",
    delete: "删除",
  },
  dialog: {
    edit_title: "编辑姓名译文",
  },
  filter: {
    placeholder: "查询 …",
    clear: "清空搜索",
    regex: "正则",
    regex_tooltip_label: "正则搜索",
    scope: {
      label: "范围",
      tooltip_label: "搜索范围",
      all: "全部",
      source: "原文",
      translation: "译文",
    },
  },
  mode: {
    status: "{TITLE}：{STATE}",
  },
  sort: {
    ascending: "升序",
    descending: "降序",
    clear: "清除排序",
  },
  confirm: {
    delete_selection: {
      description: "是否确认删除 {COUNT} 个姓名条目 …?",
    },
  },
  feedback: {
    project_required: "请先打开工程。",
    extract_success: "已提取 {COUNT} 个姓名字段。",
    extract_empty: "没有可提取的姓名字段。",
    no_pending_translation: "没有需要翻译的姓名。",
    no_importable_entries: "没有可导入术语表的姓名条目。",
    import_success: "已导入到术语表。",
    import_failed: "导入术语表失败。",
  },
} as const;

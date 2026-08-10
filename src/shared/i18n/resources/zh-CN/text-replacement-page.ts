export const zh_cn_text_replacement_page = {
  title: "文本替换",
  fields: {
    replacement: "替换",

    hit: "命中",
  },
  rule: {
    regex: "正则表达式",
    case_sensitive: "大小写敏感",
  },
  filter: {
    scope: {
      tooltip_label: "搜索范围",
    },
  },

  hit: {
    subset_relations: "存在包含关系：",

    action: {
      search_relation: "查询包含关系",
    },
  },

  feedback: {
    load_failed: "替换规则加载失败，请稍后重试。",
    save_failed: "替换页保存失败",
    import_failed: "替换页导入失败",

    export_failed: "替换页导出失败",

    preset_failed: "替换页预设加载失败",

    query_failed: "替换页查询失败",

    reset_success: "已重置 …",
  },
} as const;

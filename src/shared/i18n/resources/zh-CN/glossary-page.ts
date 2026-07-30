export const zh_cn_glossary_page = {
  title: "术语表",
  action: {
    preset: "预设",
  },
  toggle: {
    tooltip: "通过在提示词中构建术语表来引导模型翻译，可实现统一翻译、矫正人称属性等功能",
  },
  fields: {
    translation: "译文",
    description: "描述",

    statistics: "统计",
  },
  statistics: {
    action: {
      query_source: "查询出处",
      search_relation: "查询包含关系",
    },
  },
  rule: {
    case_sensitive: "大小写敏感",
  },
  filter: {
    scope: {
      translation: "译文",
      description: "备注",
    },
  },

  feedback: {
    save_failed: "术语表保存失败",
    import_failed: "术语表导入失败",

    export_failed: "术语表导出失败",

    preset_failed: "术语表预设加载失败",

    query_failed: "术语表查询失败",
  },
} as const;

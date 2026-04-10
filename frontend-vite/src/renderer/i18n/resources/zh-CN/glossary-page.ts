export const zh_cn_glossary_page = {
  title: '术语表',
  summary: '通过在提示词中构建术语表来引导模型翻译，可实现统一翻译、矫正人称属性等功能',
  action: {
    create: '新增',
    import: '导入',
    export: '导出',
    statistics: '统计',
    preset: '预设',
    edit: '编辑',
    delete: '删除',
    save: '保存',
    cancel: '取消',
  },
  toggle: {
    status: '{TITLE} - {STATE}',
    tooltip: '通过在提示词中构建术语表来引导模型翻译，可实现统一翻译、矫正人称属性等功能',
  },
  fields: {
    drag: '拖拽',
    source: '原文',
    translation: '译文',
    description: '描述',
    rule: '规则',
    statistics: '统计',
  },
  statistics: {
    hit_count: '命中条目数：{COUNT}',
    subset_relations: '存在包含关系：',
    action: {
      query_source: '查询出处',
      search_relation: '查询包含关系',
    },
  },
  rule: {
    case_sensitive: '大小写敏感',
  },
  drag: {
    disabled: '筛选生效时无法拖拽排序',
  },
  filter: {
    placeholder: '请输入关键字 …',
    clear: '清空',
    regex: '正则',
    empty: '无筛选结果',
    invalid: '正则表达式无效',
    scope: {
      label: '范围',
      all: '全部',
      source: '原文',
      translation: '译文',
      description: '备注',
    },
  },
  column_filter: {
    trigger: '筛选 {FIELD}',
    clear: '清除条件',
    operator: {
      empty: '为空',
    },
    translation: {
      empty_only: '只看空译文',
    },
    description: {
      empty_only: '只看空备注',
    },
    rule: {
      case_sensitive: '大小写敏感',
      case_insensitive: '大小写不敏感',
    },
    statistics: {
      matched: '有命中',
      unmatched: '无命中',
      related: '有关联关系',
      unavailable: '请先运行统计',
    },
  },
  empty: {
    title: '术语表为空',
    description: '点击“新增”创建第一条术语规则，或从文件导入已有术语表。',
    filtered_title: '无筛选结果',
    filtered_description: '试试调整关键词、范围或列头筛选条件。',
  },
  dialog: {
    create_title: '新增术语',
    edit_title: '编辑术语',
  },
  preset: {
    empty: '暂无可用预设',
  },
  feedback: {
    refresh_failed: '术语表刷新失败',
    save_failed: '术语表保存失败',
    import_failed: '术语表导入失败',
    export_failed: '术语表导出失败',
    statistics_failed: '术语表统计失败',
    preset_failed: '术语表预设加载失败',
    query_failed: '术语表查询失败',
    source_required: '原文不能为空',
  },
} as const

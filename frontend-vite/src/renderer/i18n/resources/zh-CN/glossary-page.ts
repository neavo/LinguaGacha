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
    query: '查询',
    save: '保存',
    cancel: '取消',
  },
  toggle: {
    tooltip: '通过在提示词中构建术语表来引导模型翻译，可实现统一翻译、矫正人称属性等功能',
  },
  fields: {
    source: '原文',
    translation: '译文',
    description: '描述',
    rule: '规则',
    status: '状态',
  },
  rule: {
    case_sensitive: '区分大小写',
  },
  search: {
    regex: '正则',
    placeholder: '搜索术语表 …',
    execute: '定位匹配项',
    previous: '上一个',
    next: '下一个',
    empty: '没有找到匹配项',
    invalid: '正则表达式无效',
  },
  empty: {
    title: '术语表为空',
    description: '点击“新增”创建第一条术语规则，或从文件导入已有术语表。',
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

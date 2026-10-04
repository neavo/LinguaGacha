export const zh_cn_quality_rule_editor = {
  confirm: {
    delete_selection: {
      description: "是否确认删除 {COUNT} 条记录 …?",
    },
    reset: {
      description: "是否确认重置数据 …?",
    },
  },
  feedback: {
    regex_invalid: "正则表达式无效",
    source_required: "原文不能为空",
  },
  fields: {
    rule: "规则",
    source: "原文",
    hit: "命中",
  },
  filter: {
    clear: "清空",
    placeholder: "查询 …",
    regex: "正则",
    regex_tooltip_label: "正则模式",
    scope: {
      all: "全部",
      label: "范围",
      tooltip_label: "搜索范围",
    },
  },
  hit: {
    hit_count: "命中条目数：{COUNT}",
    relation_line: "{CHILD} -> {PARENT}",
    subset_relations: "存在包含关系：",
    query_source: "查询出处",
    search_relation: "查询包含关系",
  },
  rule: { case_sensitive: "大小写敏感" },
} as const;

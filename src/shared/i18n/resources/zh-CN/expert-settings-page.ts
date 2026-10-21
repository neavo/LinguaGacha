export const zh_cn_expert_settings_page = {
  title: "专家设置",
  fields: {
    preceding_lines_threshold: {
      title: "参考上文行数阈值",
      description: "每个翻译任务最多可携带的参考上文的行数，默认禁用",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid: "参考上文行数阈值必须填写为有效范围内的数字 …",
  },
} as const;

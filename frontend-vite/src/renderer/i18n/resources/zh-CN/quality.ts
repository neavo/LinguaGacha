export const zh_cn_quality = {
  page: {
    glossary: {
      summary: '术语表页会管理术语条目、启用状态与批量导入结果。',
    },
    text_preserve: {
      summary: '文本保护页会约束不可翻译片段，守住格式与专有内容。',
    },
    text_replacement: {
      summary: '文本替换页会统一译前译后规则，减少重复整理成本。',
    },
    pre_translation_replacement: {
      summary: '译前替换会在任务启动前清洗原文，先把脏活累活收掉。',
    },
    post_translation_replacement: {
      summary: '译后替换会在结果回写前做收尾修整，让成品更稳。',
    },
    custom_prompt: {
      summary: '自定义提示词页会收口不同任务的额外约束与风格偏好。',
    },
    translation_prompt: {
      summary: '翻译提示词会决定模型如何理解语气、角色与输出要求。',
    },
    analysis_prompt: {
      summary: '分析提示词会定义候选抽取、分类判断与诊断口径。',
    },
  },
} as const

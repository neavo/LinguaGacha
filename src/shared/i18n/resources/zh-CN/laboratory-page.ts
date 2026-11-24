export const zh_cn_laboratory_page = {
  title: "实验室",
  fields: {
    mtool_optimizer_enable: {
      title: "MTool 优化器",
      description:
        "翻译 MTool 文本时，<emphasis>至多可减少 40% 的翻译时间与 Token 消耗</emphasis>，默认启用",
    },
    skip_duplicate_source_text_enable: {
      title: "跳过重复原文",
      description:
        "整个项目中文本相同的条目只翻译一次，<emphasis>重复项会复用已翻译的译文</emphasis>，默认启用",
    },
  },
} as const;

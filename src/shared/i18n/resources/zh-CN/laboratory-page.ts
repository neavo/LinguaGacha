export const zh_cn_laboratory_page = {
  title: "实验室",
  fields: {
    mtool_optimizer_enable: {
      title: "MTool 优化器",
      description:
        "翻译 MTool 文本时，<emphasis>至多可减少 40% 的翻译时间与词元消耗</emphasis>，默认开启",
      help_label: "查看 MTool 优化器说明",
    },
    skip_duplicate_source_text_enable: {
      title: "跳过重复原文",
      description:
        "同一文件中相同原文的条目只翻译一次，<emphasis>重复项会复用已翻译的译文</emphasis>，默认开启",
    },
  },
  feedback: {
    refresh_failed: "当前无法刷新实验室设置，请稍后重试 …",
    update_failed: "实验室设置保存失败，请稍后重试 …",
    mtool_optimizer_loading_toast: "正在刷新项目缓存 …",
    skip_duplicate_source_text_loading_toast: "正在刷新项目缓存 …",
  },
} as const;

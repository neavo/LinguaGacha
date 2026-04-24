export const zh_cn_laboratory_page = {
  title: "实验室",
  fields: {
    mtool_optimizer_enable: {
      title: "MTool 优化器",
      description:
        "翻译 <emphasis>MTool</emphasis> 文本时，至多可减少 40% 的翻译时间与词元消耗，默认开启" +
        "\n" +
        "◈ 可能导致 <emphasis>原文残留</emphasis> 或 <emphasis>语句不连贯</emphasis> 等问题",
      help_label: "查看 MTool 优化器说明",
    },
  },
  feedback: {
    refresh_failed: "当前无法刷新实验室设置，请稍后重试。",
    update_failed: "实验室设置保存失败，请稍后重试。",
    mtool_optimizer_loading_toast: "正在刷新项目缓存 …",
  },
} as const;

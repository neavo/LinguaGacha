export const zh_cn_laboratory_page = {
  title: "实验室",
  fields: {
    agent_batch_translation_thinking_adaptive_enable: {
      title: "思考等级自适应",
      description:
        "在翻译任务中，深度思考会 <emphasis>产生 3-5 倍</emphasis> 的 Token 消耗" +
        "\n" +
        "启用此功能时，翻译任务的思考挡位会智能调整以提升 Token 效率、节约时间与费用，默认启用",
    },
    prompt_enhancement_enable: {
      title: "提示词增强",
      description:
        "通过模拟思维链强化 AI 对指令的遵循" +
        "\n" +
        "关闭此功能可以略微减少 Token 消耗，但是会显著降低 AI 的智能水平，默认启用",
    },
    mtool_optimizer_enable: {
      title: "MTool 优化器",
      description:
        "翻译 MTool 文本时，<emphasis>至多可减少 40% 的翻译时间与 Token 消耗</emphasis>，默认启用",
    },
    skip_duplicate_source_text_enable: {
      title: "跳过重复原文",
      description:
        "同一文件中的相同原文条目只翻译一次，<emphasis>重复项会复用已翻译的译文</emphasis>，默认启用",
    },
  },
  feedback: {
    refresh_failed: "当前无法刷新实验室设置，请稍后重试 …",
    update_failed: "实验室设置保存失败，请稍后重试 …",
    mtool_optimizer_loading_toast: "正在刷新项目缓存 …",
    skip_duplicate_source_text_loading_toast: "正在刷新项目缓存 …",
  },
} as const;

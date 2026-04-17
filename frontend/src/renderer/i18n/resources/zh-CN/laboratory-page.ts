export const zh_cn_laboratory_page = {
  title: '实验室',
  fields: {
    mtool_optimizer_enable: {
      title: 'MTool 优化器',
      description: (
        '在对 MTool 文本进行翻译时，至多可减少 40% 的 翻译时间 与 Token 消耗'
        + '\n'
        + '可能导致 <emphasis>原文残留</emphasis> 或 <emphasis>语句不连贯</emphasis> 等问题，请 <emphasis>自行判断</emphasis> 是否启用，并且只应在 <emphasis>翻译 MTool 文本时</emphasis> 启用'
      ),
      help_label: '查看 MTool 优化器说明',
    },
    force_thinking_enable: {
      title: '强制思考',
      description: (
        '启用后，非思考模型在翻译前也会进行思考，默认启用，请注意：此功能不支持 SakuraLLM 模型'
        + '\n'
        + '◈ 通过略微增加 Token 消耗换取翻译效果的提升'
        + '\n'
        + '◈ 不建议在思考类模型上启用，重复思考意义不大'
        + '\n'
        + '◈ 正常生效时，会在翻译日志中观察到模型思考内容的输出'
      ),
      help_label: '查看强制思考说明',
    },
  },
  feedback: {
    retry: '重试',
    refresh_failed: '当前无法刷新实验室设置，请稍后重试。',
    refresh_failed_title: '实验室设置加载失败',
    update_failed: '实验室设置保存失败，请稍后重试。',
  },
} as const

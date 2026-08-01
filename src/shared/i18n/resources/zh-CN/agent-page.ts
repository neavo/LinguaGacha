export const zh_cn_agent_page = {
  title: "AGENT",
  thinking: "思考过程",
  thinking_active: "正在思考",
  diagram: { label: "图表", render_failed: "图表渲染失败，已显示 Mermaid 源码。" },
  image: { omitted: "图片已省略" },
  loading: "正在恢复会话 …",
  empty: {
    message: "「搭档」，我们接下来做点什么呢  ( •̀ ᗜ •́ )つ▱",
    suggestions: {
      capabilities: "介绍一下你的能力",
      glossary_audit: "请帮我审校术语表",
    },
  },
  input: {
    placeholder: "描述任务，或输入 @ 选择能力 …",
    hint: "Enter 发送 · Shift + Enter 换行",
  },
  context_usage: "上下文 {percent} · {used} / {total}",
  context_usage_warning: "接近上下文上限，将在达到阈值后自动整理历史",
  action: { send: "发送", stop: "停止", new_task: "新任务" },
  confirm: { new_task: "是否确认开始新的对话任务 …?" },
  status: { running: "正在处理", success: "已完成", error: "失败" },
  round: { running: "处理中 {duration}", ended: "耗时 {duration}" },
  error: "请求失败，请重试。",
} as const;

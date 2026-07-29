export const zh_cn_agent_page = {
  title: "Agent",
  conversation_label: "Agent 对话",
  loading: "正在恢复会话 …",
  empty: {
    title: "从一条明确任务开始",
    description: "输入 @ 选择术语表审校，Agent 会先查证全部语境，展示方案后再等待批准写入。",
  },
  role: { agent: "Agent", user: "你" },
  input: {
    label: "给 Agent 的消息",
    placeholder: "描述任务，或输入 @ 选择能力 …",
    hint: "Enter 发送 · Shift + Enter 换行",
  },
  action: { send: "发送", stop: "停止", reset: "新对话" },
  state: { idle: "空闲", running: "处理中", complete: "已完成" },
  skill: {
    label: "能力列表",
    prompt: "请执行已选能力所描述的任务。",
    clear: "移除能力",
  },
  tool: { label: "工具状态", running: "执行中", success: "已完成", error: "失败" },
  error: "请求失败，请重试。",
} as const;

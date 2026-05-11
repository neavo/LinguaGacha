export const zh_cn_log_window_page = {
  title: "日志",
  window_title: "日志",
  level: {
    all: "全部",
    debug: "调试",
    info: "信息",
    warning: "警告",
    error: "错误",
    fatal: "致命",
  },
  fields: {
    time: "时间",
    message: "消息",
  },
  action: {
    autoscroll: "自动滚动",
  },
  search: {
    placeholder: "查询 …",
    clear: "清空",
    regex: "正则",
    regex_tooltip: "正则模式 - {STATE}",
    regex_invalid: "正则表达式无效。",
    scope: {
      label: "范围",
      tooltip: "日志范围 - {STATE}",
    },
  },
  detail: {
    title: "详情",
    maximize: "最大化",
    minimize: "最小化",
  },
  feedback: {
    stream_failed: "日志流连接失败。",
  },
} as const;

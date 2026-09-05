export const zh_cn_batch_translation = {
  menu: {
    progress: "进度",
    tooltip: "将原文翻译为目标语言",
  },
  summary: {
    empty: "无任务",
    stopping: "停止中",
    detail_tooltip: "点击查看详情",
    running: "翻译中",
  },
  detail: {
    elapsed_time: "累计时间",
    remaining_time: "剩余时间",
    average_speed: "平均速度",
    input_tokens: "输入 Token",
    reasoning_tokens: "思考 Token",
    output_tokens: "输出 Token",
    waveform_title: "实时速度",
    metrics_title: "统计信息",

    active_requests: "实时任务数",
  },
  feedback: {
    done: "已完成 …",
    stopped: "已停止 …",
    refresh_failed: "翻译任务状态刷新失败",
    start_failed: "启动翻译任务失败",
    stop_failed: "停止翻译任务失败",
    reset_all_failed: "重置全部翻译失败",
    reset_failed_failed: "重置失败条目失败",
  },
  confirm: {
    reset_all_description: "是否确认重置整个项目的翻译进度 …?",
    reset_failed_description: "是否确认重置失败的翻译条目 …?",
    generate_description: "是否确认生成当前可用译文 …?",
    stop_description: "是否确认停止当前翻译任务 …?",
  },
  action: { stop: "停止" },
} as const;

export const zh_cn_ts_conversion_page = {
  title: "繁简转换",
  description: "将项目中的译文在简体中文和繁体中文之间转换",
  direction: {
    t2s: "繁体到简体",
    s2t: "简体到繁体",
  },
  fields: {
    direction: {
      title: "转换模式",
      description:
        "简繁转换功能由 <emphasis>OpenCC</emphasis> 实现，简体到繁体使用 S2TW 规则，繁体到简体使用 T2S 规则",
    },
    preserve_text: {
      title: "遵循文本保护规则",
      description: "遵循文本保护规则，避免翻译过程中破坏游戏文本中的代码段",
    },
    target_name: {
      title: "转换姓名字段译文",
      description:
        "部分 <emphasis>GalGame</emphasis> 中，姓名字段数据与立绘、配音等资源文件绑定，翻译后会报错，此时可以关闭该功能，默认启用",
    },
  },
  action: {
    start: "开始转换",
    preparing: "正在准备简繁转换数据 …",
    progress: "正在执行简繁转换，第 {CURRENT} 项，共 {TOTAL} 项 …",
  },
  confirm: {
    description: "是否确认开始执行简繁转换 …?",
  },
  feedback: {
    task_success: "任务执行成功 …",
    task_failed: "任务执行失败 …",
    task_running: "任务正在执行中 …",
    project_required: "请先加载工程文件 …",
    no_data: "没有有效数据 …",
  },
} as const;

export const zh_cn_function_settings_page = {
  title: "功能设置",
  fields: {
    preceding_lines_threshold: {
      title: "参考前文条目数",
      description: "设置每个任务携带的参考前文条目数，会增加 Token 消耗，默认禁用",
    },
    following_lines_threshold: {
      title: "参考后文条目数",
      description: "设置每个任务携带的参考后文条目数，会增加 Token 消耗，默认禁用",
    },
    source_language: {
      description: "设置输入文本的语言",
    },
    target_language: {
      description: "设置输出文本的语言",
    },
    project_save_mode: {
      title: "工程文件保存位置",
      description: "设置新建工程时，工程文件的保存位置",
      description_fixed: "设置新建工程时，工程文件的保存位置" + "\n" + "当前为 {PATH}",
      options: {
        manual: "每次手动选择",
        fixed: "固定目录",
        source: "源文件同目录",
      },
    },
    output_folder_open_on_finish: {
      title: "生成译文文件时打开输出文件夹",
      description: "启用此功能后，将在译文文件生成成功时自动打开输出文件夹",
    },
    request_timeout: {
      title: "请求超时时间",
      description: "发起请求时等待模型回复的最长时间（秒），超时仍未收到回复，则会判断为任务失败",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid: "参考前文条目数必须填写为 0 至 9999999 的整数 …",
    following_lines_threshold_invalid: "参考后文条目数必须填写为 0 至 9999999 的整数 …",
    request_timeout_invalid: "请求超时时间必须填写为有效范围内的数字 …",
    pick_directory_failed: "目录选择失败 …",
  },
} as const;

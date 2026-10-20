export const zh_cn_basic_settings_page = {
  title: "基础设置",
  fields: {
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
    proxy: {
      title: "出站代理",
      description: "用于翻译、Agent 与应用更新的网络请求",
      protocol_label: "协议",
      server_label: "代理服务器",
      address_label: "地址",
      port_label: "端口",
      host_placeholder: "proxy.example.com",
      server_description: "地址只填主机名或 IP，不带 http:// 和端口；IPv6 用方括号，例如 [::1]",
      port_placeholder: "端口",
      auth_label: "认证（可选）",
      username_placeholder: "用户名",
      auth_description: "用户名与密码明文保存在本机，仅用于当前代理",
      password_placeholder: "密码",
      save: "保存代理设置",
      test: "测试连接",
    },
  },
  status: {
    apply_failed: "代理设置应用失败，当前按跟随系统出站：{REASON}",
    manual_incomplete: "手动配置不完整或无效，当前按跟随系统出站",
    socks5_auth: "SOCKS5 认证在应用更新中不可用，更新将改用系统代理",
  },
  probe: {
    running: "测试中 …",
    succeeded: "成功 · {ELAPSED} ms",
    failed: "失败 · {ELAPSED} ms：{REASON}",
    route: "· 实际路由 {ROUTE}",
    route_failed: "· 路由解析失败",
  },
  feedback: {
    proxy_host_invalid: "地址不能为空，也不能包含 http://、端口或空格；IPv6 请用方括号",
    proxy_port_invalid: "端口必须是 1–65535 之间的整数",
    proxy_username_required: "填写密码时必须同时填写用户名",
    proxy_saved: "代理设置已保存",
    proxy_test_failed: "测试连接失败",
    proxy_test_unsaved: "先保存改动，再测试连接",
    request_timeout_invalid: "请求超时时间必须填写为有效范围内的数字 …",
    pick_directory_failed: "目录选择失败 …",
  },
} as const;

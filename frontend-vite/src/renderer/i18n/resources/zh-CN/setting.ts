export const zh_cn_setting = {
  language: {
    ALL: '全部',
    ZH: '中文',
    EN: '英文',
    JA: '日文',
    KO: '韩文',
    RU: '俄文',
    AR: '阿拉伯文',
    DE: '德文',
    FR: '法文',
    PL: '波兰文',
    ES: '西班牙文',
    IT: '意大利文',
    PT: '葡萄牙文',
    HU: '匈牙利文',
    TR: '土耳其文',
    TH: '泰文',
    ID: '印尼文',
    VI: '越南文',
  },
  page: {
    app: {
      summary: '应用设置页会承接桌面级偏好、窗口行为和全局体验开关。',
    },
    basic: {
      eyebrow: 'BASIC SETTINGS',
      title: '基础设置',
      summary: '把原文语言、译文语言、工程保存位置、输出文件夹行为与请求时限收进同一处，改完就立即生效。',
      busy: {
        title: '任务运行中',
        description: '任务运行中，语言设置暂时锁定，等当前流程结束后再修改就好。',
      },
      fields: {
        source_language: {
          title: '原文语言',
          description: '设置当前项目中输入文本的语言',
        },
        target_language: {
          title: '译文语言',
          description: '设置当前项目中输出文本的语言',
        },
        project_save_mode: {
          title: '工程文件保存位置',
          description: '设置新建工程时，工程文件的保存位置',
          description_fixed: '设置新建工程时，工程文件的保存位置<br>当前为 {PATH}',
          options: {
            manual: '每次手动选择',
            fixed: '固定目录',
            source: '源文件同目录',
          },
        },
        output_folder_open_on_finish: {
          title: '任务完成时打开输出文件夹',
          description: '启用此功能后，将在任务完成时自动打开输出文件夹',
          options: {
            disabled: '关闭',
            enabled: '打开',
          },
        },
        request_timeout: {
          title: '请求超时时间',
          description: '发起请求时等待模型回复的最长时间（秒），超时仍未收到回复，则会判断为任务失败',
        },
      },
      feedback: {
        saving: '保存中',
        retry: '重试',
        refresh_failed: '当前无法刷新基础设置，请稍后重试。',
        refresh_failed_title: '基础设置加载失败',
        update_failed: '设置保存失败，请稍后重试。',
        pick_directory_failed: '目录选择失败，请重新选择固定保存目录。',
      },
      footnote: {
        title: '即时保存',
        description: '每一项设置都会立即写回桌面配置；切换到固定目录时，取消选择会保留原值。',
      },
    },
    expert: {
      summary: '专家设置页会托管进阶开关和调试入口，避免主流程过载。',
    },
  },
} as const

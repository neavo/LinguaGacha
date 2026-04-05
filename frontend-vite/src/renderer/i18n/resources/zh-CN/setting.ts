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
      fields: {
        response_check_settings: {
          title: '结果检查规则',
          description: '翻译任务中会根据启用规则检查结果的合法性，默认全部启用',
          button: '规则设置',
          options: {
            kana_residue: '假名残留检查',
            hangeul_residue: '谚文残留检查',
            similarity: '相似度检查',
          },
        },
        preceding_lines_threshold: {
          title: '参考上文行数阈值',
          description: '每个翻译任务最多可携带的参考上文的行数，默认禁用',
        },
        clean_ruby: {
          title: '清理原文中的注音文本',
          description: '移除注音上标中的注音部分，仅保留正文部分，默认禁用<br>文本中的注音上标通常不能被模型正确理解，进行清理可以提升翻译质量，支持的注音格式包括但不限于：<br>• (漢字/かんじ) [漢字/かんじ] |漢字[かんじ]<br>• \\r[漢字,かんじ] \\rb[漢字,かんじ] [r_かんじ][ch_漢字] [ch_漢字]<br>• [ruby text=かんじ] [ruby text = かんじ] [ruby text="かんじ"] [ruby text = "かんじ"]',
        },
        deduplication_in_trans: {
          title: 'T++ 项目文件中对重复文本去重',
          description: '在T++ 项目文件（即 <font color=\'darkgoldenrod\'><b>.trans</b></font> 文件）中，如有重复文本是否去重，默认启用',
        },
        deduplication_in_bilingual: {
          title: '双语输出文件中原文与译文一致的文本只输出一次',
          description: '在字幕与电子书中，如目标文本的原文与译文一致是否只输出一次，默认启用',
        },
        write_translated_name_fields_to_file: {
          title: '将姓名字段译文写入输出文件',
          description: '部分 <font color=\'darkgoldenrod\'><b>GalGame</b></font> 中，姓名字段数据与立绘、配音等资源文件绑定，翻译后会报错，此时可以关闭该功能，默认启用<br>支持格式：<br>• RenPy 导出游戏文本（.rpy）<br>• VNTextPatch 或 SExtractor 导出带 name 字段的游戏文本（.json）',
        },
        auto_process_prefix_suffix_preserved_text: {
          title: '自动处理前后缀的保护文本段',
          description: '是否自动处理每个文本条目头尾命中保护规则的文本段，默认启用<br>• 启用后，头尾命中保护规则的文本段将被移除，翻译完成后再拼接回去<br>• 禁用后，会将完整的文本条目发送给模型翻译，可能会获得更完整的语义，但会降低文本保护效果',
        },
      },
      feedback: {
        retry: '重试',
        refresh_failed: '当前无法刷新专家设置，请稍后重试。',
        refresh_failed_title: '专家设置加载失败',
        update_failed: '设置保存失败，请稍后重试。',
      },
    },
  },
} as const

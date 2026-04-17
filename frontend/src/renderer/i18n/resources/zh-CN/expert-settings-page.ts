export const zh_cn_expert_settings_page = {
  title: '专家设置',
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
      description: (
        '移除注音上标中的注音部分，仅保留正文部分，默认禁用'
        + '\n' + '文本中的注音上标通常不能被模型正确理解，进行清理可以提升翻译质量，支持的注音格式包括但不限于：'
        + '\n' + '• (漢字/かんじ) [漢字/かんじ] |漢字[かんじ]'
        + '\n' + '• \\r[漢字,かんじ] \\rb[漢字,かんじ] [r_かんじ][ch_漢字] [ch_漢字]'
        + '\n' + '• [ruby text=かんじ] [ruby text = かんじ] [ruby text="かんじ"] [ruby text = "かんじ"]'
      ),
    },
    deduplication_in_trans: {
      title: 'T++ 项目文件中对重复文本去重',
      description: '在 T++ 项目文件（即 <emphasis>.trans</emphasis> 文件）中，如有重复文本是否去重，默认启用',
    },
    deduplication_in_bilingual: {
      title: '双语输出文件中原文与译文一致的文本只输出一次',
      description: '在字幕与电子书中，如目标文本的原文与译文一致是否只输出一次，默认启用',
    },
    write_translated_name_fields_to_file: {
      title: '将姓名字段译文写入输出文件',
      description: (
        '部分 <emphasis>GalGame</emphasis> 中，姓名字段数据与立绘、配音等资源文件绑定，翻译后会报错，此时可以关闭该功能，默认启用'
        + '\n' + '支持格式：'
        + '\n' + '• RenPy 导出游戏文本（.rpy）'
        + '\n' + '• VNTextPatch 或 SExtractor 导出带 name 字段的游戏文本（.json）'
      ),
    },
    auto_process_prefix_suffix_preserved_text: {
      title: '自动处理前后缀的保护文本段',
      description: (
        '是否自动处理每个文本条目头尾命中保护规则的文本段，默认启用'
        + '\n' + '• 启用后，头尾命中保护规则的文本段将被移除，翻译完成后再拼接回去'
        + '\n' + '• 禁用后，会将完整的文本条目发送给模型翻译，可能会获得更完整的语义，但会降低文本保护效果'
      ),
    },
  },
  feedback: {
    retry: '重试',
    refresh_failed: '当前无法刷新专家设置，请稍后重试。',
    refresh_failed_title: '专家设置加载失败',
    update_failed: '设置保存失败，请稍后重试。',
  },
} as const

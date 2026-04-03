export const zh_cn_common = {
  aria: {
    toggle_navigation: '切换导航',
  },
  metadata: {
    app_name: 'LinguaGacha',
  },
  action: {
    start: '开始',
    stop: '停止',
    reset: '重置',
    timer: '定时器',
  },
  workspace: {
    default_title: '工作区',
    preview_eyebrow: '桌面骨架预览',
    sidebar_width_expanded: '导航宽度 256px',
    sidebar_width_collapsed: '导航宽度 72px',
    placeholder_chip: '右侧内容暂为占位',
    content_title: '内容工作区',
    commandbar_hint: '这里后面会挂真实命令栏与状态反馈',
  },
  project: {
    home: {
      eyebrow: '工程主页 / ProjectPage',
      title: '工程主页',
      summary: '这里承接未加载工程时的双栏入口，集中展示新建工程、打开工程与最近项目预览。',
      create: {
        title: '新建工程',
        subtitle: '选择源文件创建 .lg 工程文件，创建完成后即不再需要源文件。',
        drop_title: '点击或拖拽源文件',
        action: '创建工程',
      },
      open: {
        title: '打开工程',
        subtitle: '加载现有的 .lg 工程文件以继承翻译进度、翻译规则继续工作。',
        drop_title: '点击或拖拽 .lg 文件',
        recent_title: '最近打开',
        empty: '最近项目列表为空时，会在这里显示空态引导。',
        ready_status: '项目已就绪',
        action: '打开工程',
      },
      preview: {
        file_count: '文件数量',
        created_at: '创建时间',
        updated_at: '最后修改',
        progress: '翻译进度',
        translated: '已翻译:',
        total: '总计:',
        rows_unit: '行',
      },
      formats: {
        title: '支持文件格式',
        subtitle_bundle: '字幕 / 电子书 / Markdown',
        renpy: 'RenPy 导出游戏文本',
        mtool: 'MTool 导出游戏文本',
        sextractor: 'SExtractor 导出游戏文本',
        vntextpatch: 'VNTextPatch 导出游戏文本',
        trans_project: 'Translator++ 项目文件',
        trans_export: 'Translator++ 导出游戏文本',
        wolf: 'WOLF 官方翻译工具游戏文本',
      },
    },
    model: {
      summary: '这里会接住模型配置、切换策略和供应商状态，作为桌面端工作流的起点。',
    },
  },
  profile: {
    status: 'Ciallo～(∠・ω< )⌒✮',
  },
} as const

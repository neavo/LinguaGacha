export const zh_cn_app_settings_page = {
  title: '应用设置',
  summary: '应用设置页会承接桌面级偏好、窗口行为和全局体验开关。',
  fields: {
    expert_mode: {
      title: '专家模式',
      description: '启用此功能后，将显示更多日志信息并提供更多高级设置选项（将在应用重启后生效）',
    },
  },
  restart_confirm: {
    title: '需要重启应用',
    description: '这项设置会在应用重启后生效。确认后将立即关闭当前应用，请先确保手头任务已经处理完毕。',
    actions: {
      cancel: '稍后再说',
      confirm: '确认退出',
    },
  },
  feedback: {
    retry: '重试',
    refresh_failed: '当前无法刷新应用设置，请稍后重试。',
    refresh_failed_title: '应用设置加载失败',
    update_failed: '设置保存失败，请稍后重试。',
    quit_failed: '当前无法关闭应用，请稍后手动重启。',
  },
} as const

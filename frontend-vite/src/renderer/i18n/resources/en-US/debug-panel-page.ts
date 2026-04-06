import { zh_cn_debug_panel_page } from '@/i18n/resources/zh-CN/debug-panel-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_debug_panel_page = {
  eyebrow: 'UI DEBUG PANEL',
  live_badge: 'Debug panel live',
  toast: {
    section_title: 'Toast Triggers',
    section_description: 'Use single-line Sonner toasts to verify theme switching, top-center stacking, and semantic type colors.',
    preview_label: 'Preset',
    preview_value: 'The panel uses stable single-line titles so icons, dismiss buttons, and stacked states stay easy to compare.',
    dismiss_all: 'Dismiss all toasts',
    info: {
      button: 'Trigger Info',
      title: 'Debug info delivered',
    },
    success: {
      button: 'Trigger Success',
      title: 'Debug success completed',
    },
    warning: {
      button: 'Trigger Warning',
      title: 'Debug warning triggered',
    },
    error: {
      button: 'Trigger Error',
      title: 'Debug error triggered',
    },
  },
  progress: {
    section_title: 'Progress Toast',
    section_description: 'Simulate the full lifecycle of one bottom-center progress toast from start to waiting for external progress.',
    current_value: 'Current progress',
    idle_badge: 'Idle',
    active_badge: 'Mounted',
    determinate_badge: 'Determinate',
    indeterminate_badge: 'Indeterminate',
    slider_label: 'Drag the slider or use the quick percentages to update the active progress toast.',
    start_button: 'Create / refresh progress toast',
    indeterminate_button: 'Switch to indeterminate',
    reset_button: 'Reset to 0%',
    dismiss_button: 'Dismiss active progress toast',
    toast_title: 'Debug task progress',
    status_inline_indeterminate: 'waiting for external progress',
    status_inline_idle: 'waiting to start',
    status_inline_booting: 'booting feedback',
    status_inline_running: 'running',
  },
  shell: {
    section_title: 'Shell State',
    section_description: 'Surface the active route, summary, and sidebar state to validate page composition.',
    route_title_label: 'Active title',
    route_summary_label: 'Active summary',
    sidebar_label: 'Sidebar state',
    toast_label: 'Progress toast state',
    title_key_label: 'Title key',
    summary_key_label: 'Summary key',
    sidebar_expanded: 'Sidebar width 256px',
    sidebar_collapsed: 'Sidebar width 72px',
    toast_idle: 'No progress toast is currently mounted.',
    toast_running: 'One progress toast is currently mounted and updateable.',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_debug_panel_page>

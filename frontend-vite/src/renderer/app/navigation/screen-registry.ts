import { create_debug_panel_screen } from '@/pages/debug-panel-page/create-debug-panel-screen'
import { BasicSettingsPage } from '@/pages/basic-settings-page/page'
import { ProjectPage } from '@/pages/project-page/page'
import { WorkbenchPage } from '@/pages/workbench-page/page'
import type { ScreenRegistry } from '@/app/navigation/types'

export const SCREEN_REGISTRY: ScreenRegistry = {
  'project-home': {
    component: ProjectPage,
    title_key: 'common.project.home.title',
    summary_key: 'common.project.home.summary',
  },
  model: {
    component: create_debug_panel_screen({
      title_key: 'nav.item.model',
      summary_key: 'common.project.model.summary',
    }),
    title_key: 'nav.item.model',
    summary_key: 'common.project.model.summary',
  },
  translation: {
    component: create_debug_panel_screen({
      title_key: 'nav.item.translation',
      summary_key: 'task.page.translation.summary',
    }),
    title_key: 'nav.item.translation',
    summary_key: 'task.page.translation.summary',
  },
  analysis: {
    component: create_debug_panel_screen({
      title_key: 'nav.item.analysis',
      summary_key: 'task.page.analysis.summary',
    }),
    title_key: 'nav.item.analysis',
    summary_key: 'task.page.analysis.summary',
  },
  proofreading: {
    component: create_debug_panel_screen({
      title_key: 'nav.item.proofreading',
      summary_key: 'task.page.proofreading.summary',
    }),
    title_key: 'nav.item.proofreading',
    summary_key: 'task.page.proofreading.summary',
  },
  workbench: {
    component: WorkbenchPage,
    title_key: 'nav.item.workbench',
    summary_key: 'task.page.workbench.summary',
  },
  'basic-settings': {
    component: BasicSettingsPage,
    title_key: 'nav.item.basic_settings',
    summary_key: 'setting.page.basic.summary',
  },
  'expert-settings': {
    component: create_debug_panel_screen({
      title_key: 'nav.item.expert_settings',
      summary_key: 'setting.page.expert.summary',
    }),
    title_key: 'nav.item.expert_settings',
    summary_key: 'setting.page.expert.summary',
  },
  glossary: {
    component: create_debug_panel_screen({
      title_key: 'nav.item.glossary',
      summary_key: 'quality.page.glossary.summary',
    }),
    title_key: 'nav.item.glossary',
    summary_key: 'quality.page.glossary.summary',
  },
  'text-preserve': {
    component: create_debug_panel_screen({
      title_key: 'nav.item.text_preserve',
      summary_key: 'quality.page.text_preserve.summary',
    }),
    title_key: 'nav.item.text_preserve',
    summary_key: 'quality.page.text_preserve.summary',
  },
  'text-replacement': {
    component: create_debug_panel_screen({
      title_key: 'nav.item.text_replacement',
      summary_key: 'quality.page.text_replacement.summary',
    }),
    title_key: 'nav.item.text_replacement',
    summary_key: 'quality.page.text_replacement.summary',
  },
  'pre-translation-replacement': {
    component: create_debug_panel_screen({
      title_key: 'nav.item.pre_translation_replacement',
      summary_key: 'quality.page.pre_translation_replacement.summary',
    }),
    title_key: 'nav.item.pre_translation_replacement',
    summary_key: 'quality.page.pre_translation_replacement.summary',
  },
  'post-translation-replacement': {
    component: create_debug_panel_screen({
      title_key: 'nav.item.post_translation_replacement',
      summary_key: 'quality.page.post_translation_replacement.summary',
    }),
    title_key: 'nav.item.post_translation_replacement',
    summary_key: 'quality.page.post_translation_replacement.summary',
  },
  'custom-prompt': {
    component: create_debug_panel_screen({
      title_key: 'nav.item.custom_prompt',
      summary_key: 'quality.page.custom_prompt.summary',
    }),
    title_key: 'nav.item.custom_prompt',
    summary_key: 'quality.page.custom_prompt.summary',
  },
  'translation-prompt': {
    component: create_debug_panel_screen({
      title_key: 'nav.item.translation_prompt',
      summary_key: 'quality.page.translation_prompt.summary',
    }),
    title_key: 'nav.item.translation_prompt',
    summary_key: 'quality.page.translation_prompt.summary',
  },
  'analysis-prompt': {
    component: create_debug_panel_screen({
      title_key: 'nav.item.analysis_prompt',
      summary_key: 'quality.page.analysis_prompt.summary',
    }),
    title_key: 'nav.item.analysis_prompt',
    summary_key: 'quality.page.analysis_prompt.summary',
  },
  laboratory: {
    component: create_debug_panel_screen({
      title_key: 'nav.item.laboratory',
      summary_key: 'extra.page.laboratory.summary',
    }),
    title_key: 'nav.item.laboratory',
    summary_key: 'extra.page.laboratory.summary',
  },
  toolbox: {
    component: create_debug_panel_screen({
      title_key: 'nav.item.toolbox',
      summary_key: 'extra.page.toolbox.summary',
    }),
    title_key: 'nav.item.toolbox',
    summary_key: 'extra.page.toolbox.summary',
  },
  'app-settings': {
    component: create_debug_panel_screen({
      title_key: 'nav.action.app_settings',
      summary_key: 'setting.page.app.summary',
    }),
    title_key: 'nav.action.app_settings',
    summary_key: 'setting.page.app.summary',
  },
}

import { ProjectHomePage } from '@/pages/project/home'
import { ModelPage } from '@/pages/project/model'
import { create_placeholder_screen } from '@/pages/placeholder/createPlaceholderScreen'
import { AppSettingsPage } from '@/pages/system/app-settings'
import { WorkbenchPage } from '@/pages/task/workbench'
import type { ScreenRegistry } from '@/shared/types/screens'

export const SCREEN_REGISTRY: ScreenRegistry = {
  'project-home': {
    component: ProjectHomePage,
    title_key: 'common.project.home.title',
    summary_key: 'common.project.home.summary',
  },
  model: {
    component: ModelPage,
    title_key: 'nav.item.model',
    summary_key: 'common.project.model.summary',
  },
  translation: {
    component: create_placeholder_screen({
      title_key: 'nav.item.translation',
      summary_key: 'task.page.translation.summary',
    }),
    title_key: 'nav.item.translation',
    summary_key: 'task.page.translation.summary',
  },
  analysis: {
    component: create_placeholder_screen({
      title_key: 'nav.item.analysis',
      summary_key: 'task.page.analysis.summary',
      accent_card_indices: [1],
    }),
    title_key: 'nav.item.analysis',
    summary_key: 'task.page.analysis.summary',
  },
  proofreading: {
    component: create_placeholder_screen({
      title_key: 'nav.item.proofreading',
      summary_key: 'task.page.proofreading.summary',
      accent_card_indices: [2],
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
    component: create_placeholder_screen({
      title_key: 'nav.item.basic_settings',
      summary_key: 'setting.page.basic.summary',
      card_count: 3,
    }),
    title_key: 'nav.item.basic_settings',
    summary_key: 'setting.page.basic.summary',
  },
  'expert-settings': {
    component: create_placeholder_screen({
      title_key: 'nav.item.expert_settings',
      summary_key: 'setting.page.expert.summary',
      card_count: 3,
      accent_card_indices: [0],
    }),
    title_key: 'nav.item.expert_settings',
    summary_key: 'setting.page.expert.summary',
  },
  glossary: {
    component: create_placeholder_screen({
      title_key: 'nav.item.glossary',
      summary_key: 'quality.page.glossary.summary',
    }),
    title_key: 'nav.item.glossary',
    summary_key: 'quality.page.glossary.summary',
  },
  'text-preserve': {
    component: create_placeholder_screen({
      title_key: 'nav.item.text_preserve',
      summary_key: 'quality.page.text_preserve.summary',
      accent_card_indices: [1],
    }),
    title_key: 'nav.item.text_preserve',
    summary_key: 'quality.page.text_preserve.summary',
  },
  'text-replacement': {
    component: create_placeholder_screen({
      title_key: 'nav.item.text_replacement',
      summary_key: 'quality.page.text_replacement.summary',
      card_count: 2,
      accent_card_indices: [0],
    }),
    title_key: 'nav.item.text_replacement',
    summary_key: 'quality.page.text_replacement.summary',
  },
  'pre-translation-replacement': {
    component: create_placeholder_screen({
      title_key: 'nav.item.pre_translation_replacement',
      summary_key: 'quality.page.pre_translation_replacement.summary',
      card_count: 3,
      accent_card_indices: [0],
    }),
    title_key: 'nav.item.pre_translation_replacement',
    summary_key: 'quality.page.pre_translation_replacement.summary',
  },
  'post-translation-replacement': {
    component: create_placeholder_screen({
      title_key: 'nav.item.post_translation_replacement',
      summary_key: 'quality.page.post_translation_replacement.summary',
      card_count: 3,
      accent_card_indices: [2],
    }),
    title_key: 'nav.item.post_translation_replacement',
    summary_key: 'quality.page.post_translation_replacement.summary',
  },
  'custom-prompt': {
    component: create_placeholder_screen({
      title_key: 'nav.item.custom_prompt',
      summary_key: 'quality.page.custom_prompt.summary',
      card_count: 2,
      accent_card_indices: [1],
    }),
    title_key: 'nav.item.custom_prompt',
    summary_key: 'quality.page.custom_prompt.summary',
  },
  'translation-prompt': {
    component: create_placeholder_screen({
      title_key: 'nav.item.translation_prompt',
      summary_key: 'quality.page.translation_prompt.summary',
      card_count: 3,
      accent_card_indices: [0],
    }),
    title_key: 'nav.item.translation_prompt',
    summary_key: 'quality.page.translation_prompt.summary',
  },
  'analysis-prompt': {
    component: create_placeholder_screen({
      title_key: 'nav.item.analysis_prompt',
      summary_key: 'quality.page.analysis_prompt.summary',
      card_count: 3,
      accent_card_indices: [1],
    }),
    title_key: 'nav.item.analysis_prompt',
    summary_key: 'quality.page.analysis_prompt.summary',
  },
  laboratory: {
    component: create_placeholder_screen({
      title_key: 'nav.item.laboratory',
      summary_key: 'extra.page.laboratory.summary',
      accent_card_indices: [0],
    }),
    title_key: 'nav.item.laboratory',
    summary_key: 'extra.page.laboratory.summary',
  },
  toolbox: {
    component: create_placeholder_screen({
      title_key: 'nav.item.toolbox',
      summary_key: 'extra.page.toolbox.summary',
      accent_card_indices: [3],
    }),
    title_key: 'nav.item.toolbox',
    summary_key: 'extra.page.toolbox.summary',
  },
  'app-settings': {
    component: AppSettingsPage,
    title_key: 'nav.action.app_settings',
    summary_key: 'setting.page.app.summary',
  },
}

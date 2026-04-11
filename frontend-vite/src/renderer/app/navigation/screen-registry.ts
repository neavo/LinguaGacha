import { createElement } from 'react'

import { create_debug_panel_screen } from '@/pages/debug-panel-page/create-debug-panel-screen'
import { AppSettingsPage } from '@/pages/app-settings-page/page'
import { BasicSettingsPage } from '@/pages/basic-settings-page/page'
import { ExpertSettingsPage } from '@/pages/expert-settings-page/page'
import { GlossaryPage } from '@/pages/glossary-page/page'
import { ModelPage } from '@/pages/model-page/page'
import { ProjectPage } from '@/pages/project-page/page'
import { TextPreservePage } from '@/pages/text-preserve-page/page'
import {
  TextReplacementPage,
} from '@/pages/text-replacement-page/page'
import { TextReplacementLandingPage } from '@/pages/text-replacement-page/text-replacement-landing-page'
import { WorkbenchPage } from '@/pages/workbench-page/page'
import type {
  ScreenComponentProps,
  ScreenRegistry,
} from '@/app/navigation/types'

function PreTranslationReplacementScreen(
  props: ScreenComponentProps,
): ReturnType<typeof createElement> {
  return createElement(TextReplacementPage, { ...props, variant: 'pre' })
}

function PostTranslationReplacementScreen(
  props: ScreenComponentProps,
): ReturnType<typeof createElement> {
  return createElement(TextReplacementPage, { ...props, variant: 'post' })
}

export const SCREEN_REGISTRY: ScreenRegistry = {
  'project-home': {
    component: ProjectPage,
    title_key: 'project_page.title',
    summary_key: 'project_page.summary',
  },
  model: {
    component: ModelPage,
    title_key: 'model_page.title',
    summary_key: 'model_page.summary',
  },
  translation: {
    component: create_debug_panel_screen({
      title_key: 'translation_page.title',
      summary_key: 'translation_page.summary',
    }),
    title_key: 'translation_page.title',
    summary_key: 'translation_page.summary',
  },
  analysis: {
    component: create_debug_panel_screen({
      title_key: 'analysis_page.title',
      summary_key: 'analysis_page.summary',
    }),
    title_key: 'analysis_page.title',
    summary_key: 'analysis_page.summary',
  },
  proofreading: {
    component: create_debug_panel_screen({
      title_key: 'proofreading_page.title',
      summary_key: 'proofreading_page.summary',
    }),
    title_key: 'proofreading_page.title',
    summary_key: 'proofreading_page.summary',
  },
  workbench: {
    component: WorkbenchPage,
    title_key: 'workbench_page.title',
    summary_key: 'workbench_page.summary',
  },
  'basic-settings': {
    component: BasicSettingsPage,
    title_key: 'basic_settings_page.title',
    summary_key: 'basic_settings_page.summary',
  },
  'expert-settings': {
    component: ExpertSettingsPage,
    title_key: 'expert_settings_page.title',
    summary_key: 'expert_settings_page.summary',
  },
  glossary: {
    component: GlossaryPage,
    title_key: 'glossary_page.title',
    summary_key: 'glossary_page.summary',
  },
  'text-preserve': {
    component: TextPreservePage,
    title_key: 'text_preserve_page.title',
    summary_key: 'text_preserve_page.summary',
  },
  'text-replacement': {
    component: TextReplacementLandingPage,
    title_key: 'text_replacement_page.title',
    summary_key: 'text_replacement_page.summary',
  },
  'pre-translation-replacement': {
    component: PreTranslationReplacementScreen,
    title_key: 'pre_translation_replacement_page.title',
    summary_key: 'pre_translation_replacement_page.summary',
  },
  'post-translation-replacement': {
    component: PostTranslationReplacementScreen,
    title_key: 'post_translation_replacement_page.title',
    summary_key: 'post_translation_replacement_page.summary',
  },
  'custom-prompt': {
    component: create_debug_panel_screen({
      title_key: 'custom_prompt_page.title',
      summary_key: 'custom_prompt_page.summary',
    }),
    title_key: 'custom_prompt_page.title',
    summary_key: 'custom_prompt_page.summary',
  },
  'translation-prompt': {
    component: create_debug_panel_screen({
      title_key: 'translation_prompt_page.title',
      summary_key: 'translation_prompt_page.summary',
    }),
    title_key: 'translation_prompt_page.title',
    summary_key: 'translation_prompt_page.summary',
  },
  'analysis-prompt': {
    component: create_debug_panel_screen({
      title_key: 'analysis_prompt_page.title',
      summary_key: 'analysis_prompt_page.summary',
    }),
    title_key: 'analysis_prompt_page.title',
    summary_key: 'analysis_prompt_page.summary',
  },
  laboratory: {
    component: create_debug_panel_screen({
      title_key: 'laboratory_page.title',
      summary_key: 'laboratory_page.summary',
    }),
    title_key: 'laboratory_page.title',
    summary_key: 'laboratory_page.summary',
  },
  toolbox: {
    component: create_debug_panel_screen({
      title_key: 'toolbox_page.title',
      summary_key: 'toolbox_page.summary',
    }),
    title_key: 'toolbox_page.title',
    summary_key: 'toolbox_page.summary',
  },
  'app-settings': {
    component: AppSettingsPage,
    title_key: 'app_settings_page.title',
    summary_key: 'app_settings_page.summary',
  },
}


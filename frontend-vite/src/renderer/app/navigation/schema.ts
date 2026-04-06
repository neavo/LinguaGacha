import {
  BetweenVerticalEnd,
  BetweenVerticalStart,
  BookA,
  BookOpenCheck,
  Boxes,
  FlaskConical,
  GraduationCap,
  Grid2x2Check,
  Languages,
  LayoutDashboard,
  Radar,
  ReplaceAll,
  ScanText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SunMoon,
} from 'lucide-react'

import type { BottomAction, NavigationGroup, RouteId } from '@/app/navigation/types'

export const DEFAULT_ROUTE_ID: RouteId = 'project-home'

export const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    id: 'project',
    items: [
      {
        id: 'model',
        icon: Boxes,
        title_key: 'model_page.title',
        summary_key: 'model_page.summary',
      },
    ],
  },
  {
    id: 'task',
    items: [
      {
        id: 'translation',
        icon: ScanText,
        title_key: 'translation_page.title',
        summary_key: 'translation_page.summary',
      },
      {
        id: 'analysis',
        icon: Radar,
        title_key: 'analysis_page.title',
        summary_key: 'analysis_page.summary',
      },
      {
        id: 'proofreading',
        icon: Grid2x2Check,
        title_key: 'proofreading_page.title',
        summary_key: 'proofreading_page.summary',
      },
      {
        id: 'workbench',
        icon: LayoutDashboard,
        title_key: 'workbench_page.title',
        summary_key: 'workbench_page.summary',
      },
    ],
  },
  {
    id: 'setting',
    items: [
      {
        id: 'basic-settings',
        icon: SlidersHorizontal,
        title_key: 'basic_settings_page.title',
        summary_key: 'basic_settings_page.summary',
      },
      {
        id: 'expert-settings',
        icon: GraduationCap,
        title_key: 'expert_settings_page.title',
        summary_key: 'expert_settings_page.summary',
      },
    ],
  },
  {
    id: 'quality',
    items: [
      {
        id: 'glossary',
        icon: BookA,
        title_key: 'glossary_page.title',
        summary_key: 'glossary_page.summary',
      },
      {
        id: 'text-preserve',
        icon: ShieldCheck,
        title_key: 'text_preserve_page.title',
        summary_key: 'text_preserve_page.summary',
      },
      {
        id: 'text-replacement',
        icon: ReplaceAll,
        title_key: 'text_replacement_page.title',
        summary_key: 'text_replacement_page.summary',
        children: [
          {
            id: 'pre-translation-replacement',
            icon: BetweenVerticalStart,
            title_key: 'pre_translation_replacement_page.title',
            summary_key: 'pre_translation_replacement_page.summary',
          },
          {
            id: 'post-translation-replacement',
            icon: BetweenVerticalEnd,
            title_key: 'post_translation_replacement_page.title',
            summary_key: 'post_translation_replacement_page.summary',
          },
        ],
      },
      {
        id: 'custom-prompt',
        icon: BookOpenCheck,
        title_key: 'custom_prompt_page.title',
        summary_key: 'custom_prompt_page.summary',
        children: [
          {
            id: 'translation-prompt',
            icon: ScanText,
            title_key: 'translation_prompt_page.title',
            summary_key: 'translation_prompt_page.summary',
          },
          {
            id: 'analysis-prompt',
            icon: Radar,
            title_key: 'analysis_prompt_page.title',
            summary_key: 'analysis_prompt_page.summary',
          },
        ],
      },
    ],
  },
  {
    id: 'extra',
    items: [
      {
        id: 'laboratory',
        icon: FlaskConical,
        title_key: 'laboratory_page.title',
        summary_key: 'laboratory_page.summary',
      },
      {
        id: 'toolbox',
        icon: Sparkles,
        title_key: 'toolbox_page.title',
        summary_key: 'toolbox_page.summary',
      },
    ],
  },
]

export const BOTTOM_ACTIONS: BottomAction[] = [
  {
    id: 'theme',
    label_key: 'app.navigation_action.theme',
    icon: SunMoon,
  },
  {
    id: 'language',
    label_key: 'app.navigation_action.language',
    icon: Languages,
  },
  {
    id: 'app-settings',
    label_key: 'app_settings_page.title',
    icon: Settings,
    route_id: 'app-settings',
  },
]


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
  type LucideIcon,
} from 'lucide-react'

import type { BottomAction, NavigationGroup, RouteId } from '@/app/navigation/types'
import type { ScreenRegistry } from '@/shared/types/screens'

export const DEFAULT_ROUTE_ID: RouteId = 'workbench'

export const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    id: 'project',
    items: [
      {
        id: 'model',
        icon: Boxes,
        title_key: 'nav.item.model',
        summary_key: 'common.project.model.summary',
      },
    ],
  },
  {
    id: 'task',
    items: [
      {
        id: 'translation',
        icon: ScanText,
        title_key: 'nav.item.translation',
        summary_key: 'task.page.translation.summary',
      },
      {
        id: 'analysis',
        icon: Radar,
        title_key: 'nav.item.analysis',
        summary_key: 'task.page.analysis.summary',
      },
      {
        id: 'proofreading',
        icon: Grid2x2Check,
        title_key: 'nav.item.proofreading',
        summary_key: 'task.page.proofreading.summary',
      },
      {
        id: 'workbench',
        icon: LayoutDashboard,
        title_key: 'nav.item.workbench',
        summary_key: 'task.page.workbench.summary',
      },
    ],
  },
  {
    id: 'setting',
    items: [
      {
        id: 'basic-settings',
        icon: SlidersHorizontal,
        title_key: 'nav.item.basic_settings',
        summary_key: 'setting.page.basic.summary',
      },
      {
        id: 'expert-settings',
        icon: GraduationCap,
        title_key: 'nav.item.expert_settings',
        summary_key: 'setting.page.expert.summary',
      },
    ],
  },
  {
    id: 'quality',
    items: [
      {
        id: 'glossary',
        icon: BookA,
        title_key: 'nav.item.glossary',
        summary_key: 'quality.page.glossary.summary',
      },
      {
        id: 'text-preserve',
        icon: ShieldCheck,
        title_key: 'nav.item.text_preserve',
        summary_key: 'quality.page.text_preserve.summary',
      },
      {
        id: 'text-replacement',
        icon: ReplaceAll,
        title_key: 'nav.item.text_replacement',
        summary_key: 'quality.page.text_replacement.summary',
        children: [
          {
            id: 'pre-translation-replacement',
            icon: BetweenVerticalStart,
            title_key: 'nav.item.pre_translation_replacement',
            summary_key: 'quality.page.pre_translation_replacement.summary',
          },
          {
            id: 'post-translation-replacement',
            icon: BetweenVerticalEnd,
            title_key: 'nav.item.post_translation_replacement',
            summary_key: 'quality.page.post_translation_replacement.summary',
          },
        ],
      },
      {
        id: 'custom-prompt',
        icon: BookOpenCheck,
        title_key: 'nav.item.custom_prompt',
        summary_key: 'quality.page.custom_prompt.summary',
        children: [
          {
            id: 'translation-prompt',
            icon: ScanText,
            title_key: 'nav.item.translation_prompt',
            summary_key: 'quality.page.translation_prompt.summary',
          },
          {
            id: 'analysis-prompt',
            icon: Radar,
            title_key: 'nav.item.analysis_prompt',
            summary_key: 'quality.page.analysis_prompt.summary',
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
        title_key: 'nav.item.laboratory',
        summary_key: 'extra.page.laboratory.summary',
      },
      {
        id: 'toolbox',
        icon: Sparkles,
        title_key: 'nav.item.toolbox',
        summary_key: 'extra.page.toolbox.summary',
      },
    ],
  },
]

export const BOTTOM_ACTIONS: BottomAction[] = [
  {
    id: 'theme',
    label_key: 'nav.action.theme',
    icon: SunMoon,
  },
  {
    id: 'language',
    label_key: 'nav.action.language',
    icon: Languages,
  },
  {
    id: 'app-settings',
    label_key: 'nav.action.app_settings',
    icon: Settings,
    route_id: 'app-settings',
  },
]

export function collect_registered_navigation_icons(
  screen_registry: ScreenRegistry,
): ReadonlyMap<RouteId, LucideIcon> {
  const registered_navigation_icons: Map<RouteId, LucideIcon> = new Map()

  for (const navigation_group of NAVIGATION_GROUPS) {
    for (const navigation_item of navigation_group.items) {
      if (screen_registry[navigation_item.id] !== undefined) {
        registered_navigation_icons.set(navigation_item.id, navigation_item.icon)
      }

      for (const child_navigation_item of navigation_item.children ?? []) {
        if (screen_registry[child_navigation_item.id] !== undefined) {
          registered_navigation_icons.set(child_navigation_item.id, child_navigation_item.icon)
        }
      }
    }
  }

  for (const bottom_action of BOTTOM_ACTIONS) {
    if (bottom_action.route_id !== undefined && screen_registry[bottom_action.route_id] !== undefined) {
      registered_navigation_icons.set(bottom_action.route_id, bottom_action.icon)
    }
  }

  return registered_navigation_icons
}

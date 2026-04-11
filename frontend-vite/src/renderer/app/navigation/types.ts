import type { LocaleKey } from '@/i18n'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

export const ROUTE_IDS = [
  'project-home',
  'model',
  'translation',
  'analysis',
  'proofreading',
  'workbench',
  'basic-settings',
  'expert-settings',
  'glossary',
  'text-preserve',
  'text-replacement',
  'pre-translation-replacement',
  'post-translation-replacement',
  'custom-prompt',
  'translation-prompt',
  'analysis-prompt',
  'laboratory',
  'toolbox',
  'app-settings',
] as const

export type RouteId = (typeof ROUTE_IDS)[number]

type NavigationNode = {
  id: RouteId
  icon: LucideIcon
  title_key: LocaleKey
  summary_key: LocaleKey
  children?: NavigationNode[]
}

export type NavigationGroup = {
  id: string
  items: NavigationNode[]
}

export type BottomActionId = 'theme' | 'language' | 'app-settings'

export type BottomAction = {
  id: BottomActionId
  label_key: LocaleKey
  icon: LucideIcon
  route_id?: RouteId
}

export type ScreenComponentProps = {
  is_sidebar_collapsed: boolean
}

type ScreenModule = {
  component: ComponentType<ScreenComponentProps>
  title_key: LocaleKey
  summary_key: LocaleKey
}

export type ScreenRegistry = Partial<Record<RouteId, ScreenModule>>

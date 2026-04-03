import type { LocaleKey } from '@/i18n'
import type { LucideIcon } from 'lucide-react'

export const ROUTE_IDS = [
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

export type NavigationNode = {
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

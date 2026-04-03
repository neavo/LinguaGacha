import type { RouteId } from '@/app/navigation/types'
import type { LocaleKey } from '@/i18n'
import type { ComponentType } from 'react'

export type ScreenComponentProps = {
  is_sidebar_collapsed: boolean
}

export type ScreenModule = {
  component: ComponentType<ScreenComponentProps>
  title_key: LocaleKey
  summary_key: LocaleKey
}

export type ScreenRegistry = Record<RouteId, ScreenModule>

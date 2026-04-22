/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { RouteId } from '@/app/navigation/types'

type ProofreadingLookupIntent = {
  keyword: string
  is_regex: boolean
}

type AppNavigationContextValue = {
  selected_route: RouteId
  navigate_to_route: (route_id: RouteId) => void
  proofreading_lookup_intent: ProofreadingLookupIntent | null
  push_proofreading_lookup_intent: (intent: ProofreadingLookupIntent) => void
  clear_proofreading_lookup_intent: () => void
}

const AppNavigationContext = createContext<AppNavigationContextValue | null>(null)

type AppNavigationProviderProps = {
  selected_route: RouteId
  navigate_to_route: (route_id: RouteId) => void
  children: ReactNode
}

export function AppNavigationProvider(
  props: AppNavigationProviderProps,
): JSX.Element {
  const [proofreading_lookup_intent, set_proofreading_lookup_intent] = useState<ProofreadingLookupIntent | null>(null)

  const value = useMemo<AppNavigationContextValue>(() => {
    return {
      selected_route: props.selected_route,
      navigate_to_route: props.navigate_to_route,
      proofreading_lookup_intent,
      push_proofreading_lookup_intent: set_proofreading_lookup_intent,
      clear_proofreading_lookup_intent: () => {
        set_proofreading_lookup_intent(null)
      },
    }
  }, [proofreading_lookup_intent, props.navigate_to_route, props.selected_route])

  return (
    <AppNavigationContext.Provider value={value}>
      {props.children}
    </AppNavigationContext.Provider>
  )
}

export function useAppNavigation(): AppNavigationContextValue {
  const value = useContext(AppNavigationContext)
  if (value === null) {
    throw new Error('useAppNavigation must be used inside AppNavigationProvider')
  }

  return value
}

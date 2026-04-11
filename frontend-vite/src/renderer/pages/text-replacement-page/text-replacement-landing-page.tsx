import { useEffect } from 'react'

import type { ScreenComponentProps } from '@/app/navigation/types'
import { useAppNavigation } from '@/app/navigation/navigation-context'

export function TextReplacementLandingPage(
  props: ScreenComponentProps,
): JSX.Element {
  const { navigate_to_route } = useAppNavigation()

  useEffect(() => {
    navigate_to_route('pre-translation-replacement')
  }, [navigate_to_route])

  return (
    <div
      className="page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    />
  )
}

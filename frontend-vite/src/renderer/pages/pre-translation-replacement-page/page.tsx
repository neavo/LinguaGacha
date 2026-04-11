import type { ScreenComponentProps } from '@/app/navigation/types'
import { TextReplacementPage } from '@/pages/text-replacement-page/page'

export function PreTranslationReplacementPage(
  props: ScreenComponentProps,
): JSX.Element {
  return <TextReplacementPage {...props} variant="pre" />
}

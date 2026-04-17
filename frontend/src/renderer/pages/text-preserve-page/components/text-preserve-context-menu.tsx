import { PencilLine } from 'lucide-react'

import { useI18n } from '@/i18n'
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
} from '@/shadcn/context-menu'

type TextPreserveContextMenuContentProps = {
  on_open_edit: () => void
}

export function TextPreserveContextMenuContent(
  props: TextPreserveContextMenuContentProps,
): JSX.Element {
  const { t } = useI18n()

  return (
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuItem onSelect={props.on_open_edit}>
          <PencilLine />
          {t('text_preserve_page.action.edit')}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  )
}


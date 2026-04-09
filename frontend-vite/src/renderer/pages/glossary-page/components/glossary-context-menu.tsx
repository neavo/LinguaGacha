import {
  CaseSensitive,
  Check,
  PencilLine,
  Trash2,
  X,
} from 'lucide-react'

import { useI18n } from '@/i18n'
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/ui/context-menu'

type GlossaryContextMenuContentProps = {
  on_open_edit: () => void
  on_delete_selected: () => Promise<void>
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>
}

export function GlossaryContextMenuContent(
  props: GlossaryContextMenuContentProps,
): JSX.Element {
  const { t } = useI18n()

  return (
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuItem
          onSelect={() => {
            props.on_open_edit()
          }}
        >
          <PencilLine />
          {t('glossary_page.action.edit')}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CaseSensitive />
            {t('glossary_page.rule.case_sensitive')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuGroup>
              <ContextMenuItem
                onSelect={() => {
                  void props.on_toggle_case_sensitive(true)
                }}
              >
                <Check />
                {t('app.toggle.enabled')}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  void props.on_toggle_case_sensitive(false)
                }}
              >
                <X />
                {t('app.toggle.disabled')}
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            void props.on_delete_selected()
          }}
        >
          <Trash2 />
          {t('glossary_page.action.delete')}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  )
}

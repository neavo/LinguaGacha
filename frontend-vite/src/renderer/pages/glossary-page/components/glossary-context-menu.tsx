import {
  CaseSensitive,
  PencilLine,
} from 'lucide-react'

import { useI18n } from '@/i18n'
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/shadcn/context-menu'

type GlossaryContextMenuContentProps = {
  case_sensitive_state: 'enabled' | 'disabled' | 'mixed'
  on_open_edit: () => void
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
            <ContextMenuRadioGroup
              value={props.case_sensitive_state}
              onValueChange={(next_value) => {
                if (next_value === 'enabled') {
                  void props.on_toggle_case_sensitive(true)
                } else if (next_value === 'disabled') {
                  void props.on_toggle_case_sensitive(false)
                }
              }}
            >
              <ContextMenuRadioItem value="enabled">
                {t('app.toggle.enabled')}
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="disabled">
                {t('app.toggle.disabled')}
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuGroup>
    </ContextMenuContent>
  )
}


import {
  CaseSensitive,
  Check,
  PencilLine,
  Regex,
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

type TextReplacementContextMenuContentProps = {
  on_open_edit: () => void
  on_toggle_regex: (next_value: boolean) => Promise<void>
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>
}

export function TextReplacementContextMenuContent(
  props: TextReplacementContextMenuContentProps,
): JSX.Element {
  const { t } = useI18n()

  return (
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuItem onSelect={props.on_open_edit}>
          <PencilLine />
          {t('text_replacement_page.action.edit')}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Regex />
            {t('text_replacement_page.rule.regex')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuGroup>
              <ContextMenuItem
                onSelect={() => {
                  void props.on_toggle_regex(true)
                }}
              >
                <Check />
                {t('app.toggle.enabled')}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  void props.on_toggle_regex(false)
                }}
              >
                <X />
                {t('app.toggle.disabled')}
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CaseSensitive />
            {t('text_replacement_page.rule.case_sensitive')}
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
      </ContextMenuGroup>
    </ContextMenuContent>
  )
}

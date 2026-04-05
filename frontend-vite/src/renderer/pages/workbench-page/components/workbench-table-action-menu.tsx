import { CircleEllipsis, Recycle, Replace, Trash2 } from 'lucide-react'

import { Button } from '@/ui/button'
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { useI18n } from '@/i18n'

type WorkbenchTableActionMenuProps = {
  disabled: boolean
  on_prepare_open: () => void
  on_replace: () => void
  on_reset: () => void
  on_delete: () => void
}

type WorkbenchTableActionMenuContentProps = {
  disabled: boolean
  on_replace: () => void
  on_reset: () => void
  on_delete: () => void
}

function WorkbenchTableActionMenuContent(props: WorkbenchTableActionMenuContentProps): JSX.Element {
  const { t } = useI18n()
  const menu_item_class_name = 'whitespace-nowrap'

  return (
    <DropdownMenuGroup>
      <DropdownMenuItem className={menu_item_class_name} disabled={props.disabled} onClick={props.on_replace}>
        <Replace />
        {t('task.page.workbench.action.replace')}
      </DropdownMenuItem>
      <DropdownMenuItem className={menu_item_class_name} disabled={props.disabled} onClick={props.on_reset}>
        <Recycle />
        {t('task.page.workbench.action.reset')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className={menu_item_class_name} disabled={props.disabled} variant="destructive" onClick={props.on_delete}>
        <Trash2 />
        {t('task.page.workbench.action.delete')}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

export function WorkbenchTableActionMenu(props: WorkbenchTableActionMenuProps): JSX.Element {
  const { t } = useI18n()
  const menu_content_class_name = 'w-auto min-w-max'

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(next_open) => {
        if (next_open) {
          props.on_prepare_open()
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={props.disabled}
          className="workbench-page__row-action"
          aria-label={t('task.page.workbench.table.open_actions')}
        >
          <CircleEllipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={menu_content_class_name}>
        <WorkbenchTableActionMenuContent
          disabled={props.disabled}
          on_replace={props.on_replace}
          on_reset={props.on_reset}
          on_delete={props.on_delete}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WorkbenchTableContextMenuContent(props: WorkbenchTableActionMenuContentProps): JSX.Element {
  const { t } = useI18n()
  const menu_item_class_name = 'whitespace-nowrap'
  const menu_content_class_name = 'w-auto min-w-max'

  return (
    <ContextMenuContent className={menu_content_class_name}>
      <ContextMenuGroup>
        <ContextMenuItem className={menu_item_class_name} disabled={props.disabled} onClick={props.on_replace}>
          <Replace />
          {t('task.page.workbench.action.replace')}
        </ContextMenuItem>
        <ContextMenuItem className={menu_item_class_name} disabled={props.disabled} onClick={props.on_reset}>
          <Recycle />
          {t('task.page.workbench.action.reset')}
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem className={menu_item_class_name} disabled={props.disabled} variant="destructive" onClick={props.on_delete}>
          <Trash2 />
          {t('task.page.workbench.action.delete')}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  )
}

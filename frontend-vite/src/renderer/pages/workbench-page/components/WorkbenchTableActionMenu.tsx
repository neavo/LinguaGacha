import { CircleEllipsis, Replace, RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'

type WorkbenchTableActionMenuProps = {
  disabled: boolean
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

  return (
    <DropdownMenuGroup>
      <DropdownMenuItem disabled={props.disabled} onClick={props.on_replace}>
        <Replace />
        {t('task.page.workbench.action.replace')}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={props.disabled} onClick={props.on_reset}>
        <RotateCcw />
        {t('task.page.workbench.action.reset')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={props.disabled} variant="destructive" onClick={props.on_delete}>
        <Trash2 />
        {t('task.page.workbench.action.delete')}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

export function WorkbenchTableActionMenu(props: WorkbenchTableActionMenuProps): JSX.Element {
  const { t } = useI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={props.disabled}
          className="workbench-page__row-action"
          aria-label={t('task.page.workbench.table.open_actions')}
        >
          <CircleEllipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
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

  return (
    <ContextMenuContent className="w-40">
      <ContextMenuGroup>
        <ContextMenuItem disabled={props.disabled} onClick={props.on_replace}>
          <Replace />
          {t('task.page.workbench.action.replace')}
        </ContextMenuItem>
        <ContextMenuItem disabled={props.disabled} onClick={props.on_reset}>
          <RotateCcw />
          {t('task.page.workbench.action.reset')}
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem disabled={props.disabled} variant="destructive" onClick={props.on_delete}>
          <Trash2 />
          {t('task.page.workbench.action.delete')}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  )
}

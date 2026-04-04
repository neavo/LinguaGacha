import { AlertTriangle, Info } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { useI18n, type LocaleKey } from '@/i18n'
import type { WorkbenchDialogState } from '@/pages/workbench-page/types'

type WorkbenchDialogsProps = {
  dialog_state: WorkbenchDialogState
  on_confirm: () => void
  on_close: () => void
}

type DialogCopy = {
  title_key: LocaleKey
  description_key: LocaleKey
  confirm_key: LocaleKey
  is_destructive: boolean
}

const DIALOG_COPY_BY_KIND: Record<NonNullable<WorkbenchDialogState['kind']>, DialogCopy> = {
  'replace-file': {
    title_key: 'task.page.workbench.dialog.replace.title',
    description_key: 'task.page.workbench.dialog.replace.description',
    confirm_key: 'task.page.workbench.dialog.replace.confirm',
    is_destructive: false,
  },
  'reset-file': {
    title_key: 'task.page.workbench.dialog.reset.title',
    description_key: 'task.page.workbench.dialog.reset.description',
    confirm_key: 'task.page.workbench.dialog.reset.confirm',
    is_destructive: false,
  },
  'delete-file': {
    title_key: 'task.page.workbench.dialog.delete.title',
    description_key: 'task.page.workbench.dialog.delete.description',
    confirm_key: 'task.page.workbench.dialog.delete.confirm',
    is_destructive: true,
  },
  'export-translation': {
    title_key: 'task.page.workbench.dialog.export.title',
    description_key: 'task.page.workbench.dialog.export.description',
    confirm_key: 'task.page.workbench.dialog.export.confirm',
    is_destructive: false,
  },
  'close-project': {
    title_key: 'task.page.workbench.dialog.close_project.title',
    description_key: 'task.page.workbench.dialog.close_project.description',
    confirm_key: 'task.page.workbench.dialog.close_project.confirm',
    is_destructive: false,
  },
}

function resolve_dialog_copy(dialog_state: WorkbenchDialogState): DialogCopy | null {
  if (dialog_state.kind === null) {
    return null
  } else {
    return DIALOG_COPY_BY_KIND[dialog_state.kind]
  }
}

export function WorkbenchDialogs(props: WorkbenchDialogsProps): JSX.Element {
  const { t } = useI18n()
  const dialog_copy = resolve_dialog_copy(props.dialog_state)
  const is_open = dialog_copy !== null

  return (
    <AlertDialog
      open={is_open}
      onOpenChange={(next_open) => {
        if (!next_open) {
          props.on_close()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            {dialog_copy?.is_destructive ? <AlertTriangle /> : <Info />}
          </AlertDialogMedia>
          <AlertDialogTitle>
            {dialog_copy === null ? '' : t(dialog_copy.title_key)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {dialog_copy === null ? '' : t(dialog_copy.description_key)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('task.page.workbench.dialog.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant={dialog_copy?.is_destructive ? 'destructive' : 'default'}
            onClick={props.on_confirm}
          >
            {dialog_copy === null ? '' : t(dialog_copy.confirm_key)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

import { TriangleAlert } from 'lucide-react'

import { useI18n } from '@/i18n'
import type { WorkbenchTaskConfirmDialogViewModel } from '@/pages/workbench-page/types'
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
} from '@/shadcn/alert-dialog'
import { Spinner } from '@/shadcn/spinner'

type TaskRuntimeConfirmDialogProps = {
  view_model: WorkbenchTaskConfirmDialogViewModel | null
  on_confirm: () => Promise<void>
  on_close: () => void
}

export function TaskRuntimeConfirmDialog(
  props: TaskRuntimeConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n()
  const is_submitting = props.view_model?.submitting ?? false

  return (
    <AlertDialog
      open={props.view_model?.open ?? false}
      onOpenChange={(next_open) => {
        if (!next_open) {
          props.on_close()
        }
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlert />
          </AlertDialogMedia>
          <AlertDialogTitle>{props.view_model?.title ?? ''}</AlertDialogTitle>
          <AlertDialogDescription>{props.view_model?.description ?? ''}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={is_submitting}>
            {props.view_model?.cancel_label ?? t('app.action.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={is_submitting}
            onClick={(event) => {
              event.preventDefault()
              void props.on_confirm()
            }}
          >
            {is_submitting
              ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    {t('app.action.loading')}
                  </>
                )
              : props.view_model?.confirm_label ?? ''}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

import { TriangleAlert } from 'lucide-react'

import { useI18n } from '@/i18n'
import type { TranslationTaskConfirmState } from '@/lib/translation-task'
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

type TranslationTaskConfirmDialogProps = {
  state: TranslationTaskConfirmState | null
  on_confirm: () => Promise<void>
  on_close: () => void
}

function resolve_confirm_copy(
  state: TranslationTaskConfirmState | null,
  t: ReturnType<typeof useI18n>['t'],
): {
  title: string
  description: string
  confirm_label: string
} {
  if (state?.kind === 'reset-all') {
    return {
      title: t('proofreading_page.task.confirm.reset_all_title'),
      description: t('proofreading_page.task.confirm.reset_all_description'),
      confirm_label: t('proofreading_page.action.reset_translation_all'),
    }
  }

  if (state?.kind === 'reset-failed') {
    return {
      title: t('proofreading_page.task.confirm.reset_failed_title'),
      description: t('proofreading_page.task.confirm.reset_failed_description'),
      confirm_label: t('proofreading_page.action.reset_translation_failed'),
    }
  }

  return {
    title: t('proofreading_page.task.confirm.stop_title'),
    description: t('proofreading_page.task.confirm.stop_description'),
    confirm_label: t('proofreading_page.action.stop_translation'),
  }
}

export function TranslationTaskConfirmDialog(
  props: TranslationTaskConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n()
  const confirm_copy = resolve_confirm_copy(props.state, t)
  const is_submitting = props.state?.submitting ?? false

  return (
    <AlertDialog
      open={props.state?.open ?? false}
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
          <AlertDialogTitle>{confirm_copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm_copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={is_submitting}>
            {t('proofreading_page.action.cancel')}
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
              : confirm_copy.confirm_label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

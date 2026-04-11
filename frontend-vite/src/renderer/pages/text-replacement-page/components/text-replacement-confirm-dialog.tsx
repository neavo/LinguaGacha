import { AlertTriangle, Info } from 'lucide-react'

import { useI18n, type LocaleKey } from '@/i18n'
import type { TextReplacementConfirmState } from '@/pages/text-replacement-page/types'
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

type TextReplacementConfirmDialogProps = {
  state: TextReplacementConfirmState
  on_confirm: () => void
  on_close: () => void
}

type ConfirmCopy = {
  title_key: LocaleKey
  description_key: LocaleKey
  confirm_key: LocaleKey
  destructive: boolean
}

const CONFIRM_COPY_BY_KIND: Record<
  NonNullable<TextReplacementConfirmState['kind']>,
  ConfirmCopy
> = {
  'delete-selection': {
    title_key: 'text_replacement_page.confirm.delete_selection.title',
    description_key: 'text_replacement_page.confirm.delete_selection.description',
    confirm_key: 'text_replacement_page.confirm.delete_selection.confirm',
    destructive: true,
  },
  'delete-entry': {
    title_key: 'text_replacement_page.confirm.delete_entry.title',
    description_key: 'text_replacement_page.confirm.delete_entry.description',
    confirm_key: 'text_replacement_page.confirm.delete_entry.confirm',
    destructive: true,
  },
  'delete-preset': {
    title_key: 'text_replacement_page.confirm.delete_preset.title',
    description_key: 'text_replacement_page.confirm.delete_preset.description',
    confirm_key: 'text_replacement_page.confirm.delete_preset.confirm',
    destructive: true,
  },
  reset: {
    title_key: 'text_replacement_page.confirm.reset.title',
    description_key: 'text_replacement_page.confirm.reset.description',
    confirm_key: 'text_replacement_page.confirm.reset.confirm',
    destructive: false,
  },
  'overwrite-preset': {
    title_key: 'text_replacement_page.confirm.overwrite_preset.title',
    description_key: 'text_replacement_page.confirm.overwrite_preset.description',
    confirm_key: 'text_replacement_page.confirm.overwrite_preset.confirm',
    destructive: false,
  },
}

export function TextReplacementConfirmDialog(
  props: TextReplacementConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n()
  const dialog_copy = props.state.kind === null
    ? null
    : CONFIRM_COPY_BY_KIND[props.state.kind]
  const description = dialog_copy === null
    ? ''
    : t(dialog_copy.description_key)
      .replace('{COUNT}', props.state.selection_count.toString())
      .replace('{NAME}', props.state.preset_name)

  return (
    <AlertDialog
      open={props.state.open}
      onOpenChange={(next_open) => {
        if (!next_open) {
          props.on_close()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            {dialog_copy?.destructive ? <AlertTriangle /> : <Info />}
          </AlertDialogMedia>
          <AlertDialogTitle>
            {dialog_copy === null ? '' : t(dialog_copy.title_key)}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.state.submitting}>
            {t('app.action.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={dialog_copy?.destructive ? 'destructive' : 'default'}
            disabled={props.state.submitting}
            onClick={props.on_confirm}
          >
            {dialog_copy === null ? '' : t(dialog_copy.confirm_key)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}


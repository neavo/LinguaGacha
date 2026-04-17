import { AlertTriangle, Info } from 'lucide-react'

import { useI18n, type LocaleKey } from '@/i18n'
import type { CustomPromptConfirmState } from '@/pages/custom-prompt-page/types'
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

type CustomPromptConfirmDialogProps = {
  state: CustomPromptConfirmState
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
  NonNullable<CustomPromptConfirmState['kind']>,
  ConfirmCopy
> = {
  reset: {
    title_key: 'custom_prompt_page.confirm.reset.title',
    description_key: 'custom_prompt_page.confirm.reset.description',
    confirm_key: 'custom_prompt_page.confirm.reset.confirm',
    destructive: false,
  },
  'delete-preset': {
    title_key: 'custom_prompt_page.confirm.delete_preset.title',
    description_key: 'custom_prompt_page.confirm.delete_preset.description',
    confirm_key: 'custom_prompt_page.confirm.delete_preset.confirm',
    destructive: true,
  },
  'overwrite-preset': {
    title_key: 'custom_prompt_page.confirm.overwrite_preset.title',
    description_key: 'custom_prompt_page.confirm.overwrite_preset.description',
    confirm_key: 'custom_prompt_page.confirm.overwrite_preset.confirm',
    destructive: false,
  },
}

export function CustomPromptConfirmDialog(
  props: CustomPromptConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n()
  const dialog_copy = props.state.kind === null
    ? null
    : CONFIRM_COPY_BY_KIND[props.state.kind]
  const description = dialog_copy === null
    ? ''
    : t(dialog_copy.description_key)
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

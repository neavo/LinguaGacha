import { useI18n } from '@/i18n'
import type { ProofreadingPendingMutation } from '@/pages/proofreading-page/types'
import { Button } from '@/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shadcn/dialog'

type ProofreadingConfirmDialogProps = {
  state: ProofreadingPendingMutation | null
  on_confirm: () => Promise<void>
  on_close: () => void
}

export function ProofreadingConfirmDialog(
  props: ProofreadingConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n()
  const selection_count = props.state?.target_row_ids.length ?? 0
  const is_retranslate = props.state?.kind === 'retranslate-items'
  const title = is_retranslate
    ? t('proofreading_page.confirm.retranslate_title')
    : t('proofreading_page.confirm.reset_title')
  const description = is_retranslate
    ? t('proofreading_page.confirm.retranslate_description').replace('{COUNT}', selection_count.toString())
    : t('proofreading_page.confirm.reset_description').replace('{COUNT}', selection_count.toString())
  const confirm_label = is_retranslate
    ? t('proofreading_page.action.retranslate')
    : t('proofreading_page.action.reset_translation')

  return (
    <Dialog
      open={props.state !== null}
      onOpenChange={(next_open) => {
        if (!next_open) {
          props.on_close()
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.on_close}>
            {t('proofreading_page.action.cancel')}
          </Button>
          <Button type="button" onClick={() => { void props.on_confirm() }}>
            {confirm_label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

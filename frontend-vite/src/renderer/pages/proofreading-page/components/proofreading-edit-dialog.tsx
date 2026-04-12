import {
  Recycle,
  RefreshCcw,
} from 'lucide-react'

import { useI18n } from '@/i18n'
import {
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
  type ProofreadingItem,
} from '@/pages/proofreading-page/types'
import { Badge } from '@/shadcn/badge'
import { Button } from '@/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/shadcn/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shadcn/dropdown-menu'
import { Textarea } from '@/shadcn/textarea'

type ProofreadingEditDialogProps = {
  open: boolean
  item: ProofreadingItem | null
  draft_dst: string
  saving: boolean
  readonly: boolean
  on_change: (next_draft_dst: string) => void
  on_save: () => Promise<void>
  on_close: () => void
  on_request_retranslate: (row_ids: string[]) => void
  on_request_reset: (row_ids: string[]) => void
}

function resolve_status_badge_variant(status: string): 'secondary' | 'default' | 'destructive' | 'outline' {
  if (status === 'PROCESSED') {
    return 'default'
  }
  if (status === 'ERROR') {
    return 'destructive'
  }

  return 'outline'
}

export function ProofreadingEditDialog(
  props: ProofreadingEditDialogProps,
): JSX.Element | null {
  const { t } = useI18n()

  if (props.item === null) {
    return null
  }

  const status_label_key = PROOFREADING_STATUS_LABEL_KEY_BY_CODE[
    props.item.status as keyof typeof PROOFREADING_STATUS_LABEL_KEY_BY_CODE
  ]
  const status_label = status_label_key === undefined ? props.item.status : t(status_label_key)
  const can_save = !props.readonly && !props.saving && props.draft_dst !== props.item.dst

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open && !props.saving) {
          props.on_close()
        }
      }}
    >
      <DialogContent size="lg" className="proofreading-page__dialog-shell">
        <DialogTitle className="sr-only">{t('proofreading_page.dialog.edit_title')}</DialogTitle>

        <div className="proofreading-page__dialog-scroll">
          <div className="proofreading-page__dialog-form">
            <section className="proofreading-page__dialog-file-card">
              <span className="proofreading-page__dialog-file-path">{props.item.file_path}</span>
              <span className="proofreading-page__dialog-file-row">#{props.item.row_number}</span>
            </section>

            <section className="proofreading-page__dialog-status-strip">
              <Badge variant={resolve_status_badge_variant(props.item.status)}>
                {status_label}
              </Badge>
              {props.item.warnings.map((warning) => {
                const label_key = PROOFREADING_WARNING_LABEL_KEY_BY_CODE[
                  warning as keyof typeof PROOFREADING_WARNING_LABEL_KEY_BY_CODE
                ]
                return (
                  <Badge key={warning} variant={warning === 'SIMILARITY' ? 'destructive' : 'outline'}>
                    {label_key === undefined ? warning : t(label_key)}
                  </Badge>
                )
              })}
            </section>

            <section className="proofreading-page__dialog-editor-block">
              <label className="proofreading-page__dialog-editor-section">
                <span className="proofreading-page__dialog-editor-title">
                  {t('proofreading_page.fields.source')}
                </span>
                <Textarea
                  readOnly
                  value={props.item.src}
                  className="proofreading-page__dialog-editor proofreading-page__dialog-editor--readonly"
                />
              </label>

              <label className="proofreading-page__dialog-editor-section">
                <span className="proofreading-page__dialog-editor-title">
                  {t('proofreading_page.fields.translation')}
                </span>
                <Textarea
                  value={props.draft_dst}
                  readOnly={props.readonly || props.saving}
                  className="proofreading-page__dialog-editor"
                  onChange={(event) => {
                    props.on_change(event.target.value)
                  }}
                />
              </label>
            </section>
          </div>
        </div>

        <DialogFooter className="proofreading-page__dialog-footer">
          <Button type="button" variant="outline" disabled={props.saving} onClick={props.on_close}>
            {t('proofreading_page.action.cancel')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" disabled={props.readonly || props.saving}>
                {t('proofreading_page.action.more')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={props.readonly || props.saving}
                  onClick={() => {
                    props.on_request_retranslate([String(props.item?.item_id ?? '')])
                  }}
                >
                  <RefreshCcw />
                  {t('proofreading_page.action.retranslate')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={props.readonly || props.saving}
                  onClick={() => {
                    props.on_request_reset([String(props.item?.item_id ?? '')])
                  }}
                >
                  <Recycle />
                  {t('proofreading_page.action.reset_translation')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" disabled={!can_save} onClick={() => { void props.on_save() }}>
            {t('proofreading_page.action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

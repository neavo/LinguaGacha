import { useI18n } from '@/i18n'
import type {
  TextPreserveDialogMode,
  TextPreserveEntry,
} from '@/pages/text-preserve-page/types'
import { Button } from '@/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/shadcn/dialog'
import { Textarea } from '@/shadcn/textarea'

type TextPreserveEditDialogProps = {
  open: boolean
  mode: TextPreserveDialogMode
  entry: TextPreserveEntry
  saving: boolean
  validation_message: string | null
  on_change: (patch: Partial<TextPreserveEntry>) => void
  on_save: () => Promise<void>
  on_close: () => Promise<void>
}

export function TextPreserveEditDialog(
  props: TextPreserveEditDialogProps,
): JSX.Element {
  const { t } = useI18n()
  const title = props.mode === 'create'
    ? t('text_preserve_page.dialog.create_title')
    : t('text_preserve_page.dialog.edit_title')

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open) {
          void props.on_close()
        }
      }}
    >
      <DialogContent
        size="lg"
        className="text-preserve-page__dialog-shell"
        onPointerDownOutside={(event) => {
          event.preventDefault()
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>

        <div className="text-preserve-page__dialog-scroll">
          <div className="text-preserve-page__dialog-form">
            <div className="text-preserve-page__dialog-main-panel">
              <div className="text-preserve-page__dialog-main-panel-content">
                <label className="text-preserve-page__dialog-section">
                  <span
                    className="text-preserve-page__dialog-section-title"
                    data-ui-text="emphasis"
                  >
                    {t('text_preserve_page.fields.rule')}
                  </span>
                  <Textarea
                    className="text-preserve-page__dialog-editor text-preserve-page__dialog-editor--rule min-h-0 h-full text-[13px] md:text-[13px]"
                    style={{ backgroundColor: 'var(--popover)' }}
                    value={props.entry.src}
                    disabled={props.saving}
                    aria-invalid={props.validation_message !== null}
                    placeholder={t('text_preserve_page.fields.rule')}
                    onChange={(event) => {
                      props.on_change({ src: event.target.value })
                    }}
                  />
                  {props.validation_message === null
                    ? null
                    : (
                        <span className="text-preserve-page__dialog-error">
                          {props.validation_message}
                        </span>
                      )}
                </label>

                <label className="text-preserve-page__dialog-section">
                  <span
                    className="text-preserve-page__dialog-section-title"
                    data-ui-text="emphasis"
                  >
                    {t('text_preserve_page.fields.note')}
                  </span>
                  <Textarea
                    className="text-preserve-page__dialog-editor text-preserve-page__dialog-editor--note min-h-0 h-full text-[13px] md:text-[13px]"
                    style={{ backgroundColor: 'var(--popover)' }}
                    value={props.entry.info}
                    disabled={props.saving}
                    placeholder={t('text_preserve_page.fields.note')}
                    onChange={(event) => {
                      props.on_change({ info: event.target.value })
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="text-preserve-page__dialog-footer">
          <div className="text-preserve-page__dialog-footer-actions">
            <Button
              type="button"
              variant="outline"
              disabled={props.saving}
              onClick={() => {
                void props.on_close()
              }}
            >
              {t('text_preserve_page.action.cancel')}
            </Button>
            <Button
              type="button"
              disabled={props.saving}
              onClick={() => {
                void props.on_save()
              }}
            >
              {t('text_preserve_page.action.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


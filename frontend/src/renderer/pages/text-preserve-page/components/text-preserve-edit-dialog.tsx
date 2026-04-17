import { useI18n } from '@/i18n'
import { useSaveShortcut } from '@/hooks/use-save-shortcut'
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
import { Kbd } from '@/shadcn/kbd'
import { AppEditor } from '@/widgets/app-editor/app-editor'

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
  const save_label = t('text_preserve_page.action.save')
  const title = props.mode === 'create'
    ? t('text_preserve_page.dialog.create_title')
    : t('text_preserve_page.dialog.edit_title')

  useSaveShortcut({
    enabled: props.open && !props.saving,
    on_save: () => {
      void props.on_save()
    },
  })

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
                    className="text-preserve-page__dialog-section-title font-medium"
                  >
                    {t('text_preserve_page.fields.rule')}
                  </span>
                  <AppEditor
                    class_name="text-preserve-page__dialog-editor"
                    value={props.entry.src}
                    aria_label={t('text_preserve_page.fields.rule')}
                    read_only={props.saving}
                    invalid={props.validation_message !== null}
                    on_change={(next_value) => {
                      props.on_change({ src: next_value })
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
                    className="text-preserve-page__dialog-section-title font-medium"
                  >
                    {t('text_preserve_page.fields.note')}
                  </span>
                  <AppEditor
                    class_name="text-preserve-page__dialog-editor"
                    value={props.entry.info}
                    aria_label={t('text_preserve_page.fields.note')}
                    read_only={props.saving}
                    on_change={(next_value) => {
                      props.on_change({ info: next_value })
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
              {save_label}
              <Kbd className="bg-background/18 text-primary-foreground">Ctrl+S</Kbd>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


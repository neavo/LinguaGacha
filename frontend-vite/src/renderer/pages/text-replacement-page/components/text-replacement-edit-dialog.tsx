import {
  CaseSensitive,
  Regex,
} from 'lucide-react'

import { useI18n } from '@/i18n'
import type {
  TextReplacementDialogMode,
  TextReplacementEntry,
} from '@/pages/text-replacement-page/types'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/ui/dialog'
import { Textarea } from '@/ui/textarea'
import { BooleanSegmentedToggle } from '@/widgets/boolean-segmented-toggle/boolean-segmented-toggle'

type TextReplacementEditDialogProps = {
  open: boolean
  mode: TextReplacementDialogMode
  entry: TextReplacementEntry
  saving: boolean
  validation_message: string | null
  on_change: (patch: Partial<TextReplacementEntry>) => void
  on_save: () => Promise<void>
  on_close: () => Promise<void>
}

export function TextReplacementEditDialog(
  props: TextReplacementEditDialogProps,
): JSX.Element {
  const { t } = useI18n()
  const title = props.mode === 'create'
    ? t('text_replacement_page.dialog.create_title')
    : t('text_replacement_page.dialog.edit_title')

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
        className="text-replacement-page__dialog-shell"
        onPointerDownOutside={(event) => {
          event.preventDefault()
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>

        <div className="text-replacement-page__dialog-scroll">
          <div className="text-replacement-page__dialog-form">
            <div className="text-replacement-page__dialog-main-panel">
              <div className="text-replacement-page__dialog-main-panel-content">
                <label className="text-replacement-page__dialog-section">
                  <span
                    className="text-replacement-page__dialog-section-title"
                    data-ui-text="emphasis"
                  >
                    {t('text_replacement_page.fields.source')}
                  </span>
                  <Textarea
                    className="text-replacement-page__dialog-editor min-h-0 h-full text-[13px] md:text-[13px]"
                    value={props.entry.src}
                    disabled={props.saving}
                    aria-invalid={props.validation_message !== null}
                    placeholder={t('text_replacement_page.fields.source')}
                    onChange={(event) => {
                      props.on_change({ src: event.target.value })
                    }}
                  />
                  {props.validation_message === null
                    ? null
                    : (
                        <span className="text-replacement-page__dialog-error">
                          {props.validation_message}
                        </span>
                      )}
                </label>

                <label className="text-replacement-page__dialog-section">
                  <span
                    className="text-replacement-page__dialog-section-title"
                    data-ui-text="emphasis"
                  >
                    {t('text_replacement_page.fields.replacement')}
                  </span>
                  <Textarea
                    className="text-replacement-page__dialog-editor min-h-0 h-full text-[13px] md:text-[13px]"
                    value={props.entry.dst}
                    disabled={props.saving}
                    placeholder={t('text_replacement_page.fields.replacement')}
                    onChange={(event) => {
                      props.on_change({ dst: event.target.value })
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="text-replacement-page__dialog-rule-grid">
              <div className="text-replacement-page__dialog-rule-item">
                <div className="text-replacement-page__dialog-rule-copy">
                  <span className="text-replacement-page__rule-badge-wrap" aria-hidden="true">
                    <span
                      data-state={props.entry.regex ? 'active' : 'inactive'}
                      className="text-replacement-page__rule-badge text-replacement-page__dialog-rule-badge"
                    >
                      <Regex />
                    </span>
                  </span>
                  <span
                    className="text-replacement-page__dialog-rule-title"
                    data-ui-text="emphasis"
                  >
                    {t('text_replacement_page.rule.regex')}
                  </span>
                </div>
                <BooleanSegmentedToggle
                  aria_label={t('text_replacement_page.rule.regex')}
                  value={props.entry.regex}
                  disabled={props.saving}
                  size="sm"
                  on_value_change={(next_value) => {
                    props.on_change({ regex: next_value })
                  }}
                />
              </div>

              <div className="text-replacement-page__dialog-rule-item">
                <div className="text-replacement-page__dialog-rule-copy">
                  <span className="text-replacement-page__rule-badge-wrap" aria-hidden="true">
                    <span
                      data-state={props.entry.case_sensitive ? 'active' : 'inactive'}
                      className="text-replacement-page__rule-badge text-replacement-page__dialog-rule-badge"
                    >
                      <CaseSensitive />
                    </span>
                  </span>
                  <span
                    className="text-replacement-page__dialog-rule-title"
                    data-ui-text="emphasis"
                  >
                    {t('text_replacement_page.rule.case_sensitive')}
                  </span>
                </div>
                <BooleanSegmentedToggle
                  aria_label={t('text_replacement_page.rule.case_sensitive')}
                  value={props.entry.case_sensitive}
                  disabled={props.saving}
                  size="sm"
                  on_value_change={(next_value) => {
                    props.on_change({ case_sensitive: next_value })
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="text-replacement-page__dialog-footer">
          <div className="text-replacement-page__dialog-footer-actions">
            <Button
              type="button"
              variant="outline"
              disabled={props.saving}
              onClick={() => {
                void props.on_close()
              }}
            >
              {t('text_replacement_page.action.cancel')}
            </Button>
            <Button
              type="button"
              disabled={props.saving}
              onClick={() => {
                void props.on_save()
              }}
            >
              {t('text_replacement_page.action.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

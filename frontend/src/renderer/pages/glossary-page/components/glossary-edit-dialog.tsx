import { CaseSensitive } from 'lucide-react'

import { useI18n } from '@/i18n'
import { useSaveShortcut } from '@/hooks/use-save-shortcut'
import type {
  GlossaryDialogMode,
  GlossaryEntry,
} from '@/pages/glossary-page/types'
import { Button } from '@/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/shadcn/dialog'
import { Kbd } from '@/shadcn/kbd'
import { AppEditor } from '@/widgets/app-editor/app-editor'
import { SegmentedToggle } from '@/widgets/segmented-toggle/segmented-toggle'

type GlossaryEditDialogProps = {
  open: boolean
  mode: GlossaryDialogMode
  entry: GlossaryEntry
  saving: boolean
  on_change: (patch: Partial<GlossaryEntry>) => void
  on_save: () => Promise<void>
  on_close: () => Promise<void>
}

export function GlossaryEditDialog(props: GlossaryEditDialogProps): JSX.Element {
  const { t } = useI18n()
  const save_label = t('glossary_page.action.save')
  const boolean_segmented_options = [
    {
      value: 'disabled',
      label: t('app.toggle.disabled'),
    },
    {
      value: 'enabled',
      label: t('app.toggle.enabled'),
    },
  ] as const
  const title = props.mode === 'create'
    ? t('glossary_page.dialog.create_title')
    : t('glossary_page.dialog.edit_title')

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
        className="glossary-page__dialog-shell"
        onPointerDownOutside={(event) => {
          event.preventDefault()
        }}
      >
        {/* 保留仅供辅助技术使用的标题，满足 Dialog 的可访问性要求。 */}
        <DialogTitle className="sr-only">{title}</DialogTitle>

        <div className="glossary-page__dialog-scroll">
          <div className="glossary-page__dialog-form">
            <div className="glossary-page__dialog-main-panel">
              <div className="glossary-page__dialog-main-panel-content">
                <label className="glossary-page__dialog-section">
                  <span
                    className="glossary-page__dialog-section-title font-medium"
                  >
                    {t('glossary_page.fields.source')}
                  </span>
                  <AppEditor
                    class_name="glossary-page__dialog-editor"
                    value={props.entry.src}
                    aria_label={t('glossary_page.fields.source')}
                    read_only={props.saving}
                    on_change={(next_value) => {
                      props.on_change({ src: next_value })
                    }}
                  />
                </label>

                <label className="glossary-page__dialog-section">
                  <span
                    className="glossary-page__dialog-section-title font-medium"
                  >
                    {t('glossary_page.fields.translation')}
                  </span>
                  <AppEditor
                    class_name="glossary-page__dialog-editor"
                    value={props.entry.dst}
                    aria_label={t('glossary_page.fields.translation')}
                    read_only={props.saving}
                    on_change={(next_value) => {
                      props.on_change({ dst: next_value })
                    }}
                  />
                </label>

                <label className="glossary-page__dialog-section glossary-page__dialog-section--description">
                  <span
                    className="glossary-page__dialog-section-title font-medium"
                  >
                    {t('glossary_page.fields.description')}
                  </span>
                  <AppEditor
                    class_name="glossary-page__dialog-editor"
                    value={props.entry.info}
                    aria_label={t('glossary_page.fields.description')}
                    read_only={props.saving}
                    on_change={(next_value) => {
                      props.on_change({ info: next_value })
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="glossary-page__dialog-rule-grid">
              <div className="glossary-page__dialog-rule-item">
                <div className="glossary-page__dialog-rule-copy">
                  <span className="glossary-page__rule-badge-wrap" aria-hidden="true">
                    <span
                      data-state="inactive"
                      className="glossary-page__rule-badge glossary-page__dialog-rule-badge"
                    >
                      <CaseSensitive />
                    </span>
                  </span>
                  <span
                    className="glossary-page__dialog-rule-title font-medium"
                  >
                    {t('glossary_page.rule.case_sensitive')}
                  </span>
                </div>
                <SegmentedToggle
                  aria_label={t('glossary_page.rule.case_sensitive')}
                  value={props.entry.case_sensitive ? 'enabled' : 'disabled'}
                  options={boolean_segmented_options}
                  disabled={props.saving}
                  size="sm"
                  on_value_change={(next_value) => {
                    props.on_change({
                      case_sensitive:
                        next_value === 'enabled',
                    })
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={props.saving}
            onClick={() => {
              void props.on_close()
            }}
          >
            {t('glossary_page.action.cancel')}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


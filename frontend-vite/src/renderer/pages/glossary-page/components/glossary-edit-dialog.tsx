import { useI18n } from '@/i18n'
import type {
  GlossaryDialogMode,
  GlossaryEntry,
} from '@/pages/glossary-page/types'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Textarea } from '@/ui/textarea'
import { BooleanSegmentedToggle } from '@/widgets/boolean-segmented-toggle/boolean-segmented-toggle'

type GlossaryEditDialogProps = {
  open: boolean
  mode: GlossaryDialogMode
  entry: GlossaryEntry
  dirty: boolean
  saving: boolean
  on_change: (patch: Partial<GlossaryEntry>) => void
  on_save: () => Promise<void>
  on_delete: () => Promise<void>
  on_query: () => Promise<void>
  on_close: () => Promise<void>
}

export function GlossaryEditDialog(props: GlossaryEditDialogProps): JSX.Element {
  const { t } = useI18n()
  const title = props.mode === 'create'
    ? t('glossary_page.dialog.create_title')
    : t('glossary_page.dialog.edit_title')

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
        className="glossary-page__dialog-content"
        onPointerDownOutside={(event) => {
          event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('glossary_page.summary')}</DialogDescription>
        </DialogHeader>

        <div className="glossary-page__dialog-body">
          <label className="glossary-page__dialog-field">
            <span className="glossary-page__dialog-label">{t('glossary_page.fields.source')}</span>
            <Input
              value={props.entry.src}
              disabled={props.saving}
              placeholder={t('glossary_page.fields.source')}
              onChange={(event) => {
                props.on_change({ src: event.target.value })
              }}
            />
          </label>
          <label className="glossary-page__dialog-field">
            <span className="glossary-page__dialog-label">{t('glossary_page.fields.translation')}</span>
            <Input
              value={props.entry.dst}
              disabled={props.saving}
              placeholder={t('glossary_page.fields.translation')}
              onChange={(event) => {
                props.on_change({ dst: event.target.value })
              }}
            />
          </label>
          <label className="glossary-page__dialog-field">
            <span className="glossary-page__dialog-label">{t('glossary_page.fields.description')}</span>
            <Textarea
              className="glossary-page__dialog-textarea"
              value={props.entry.info}
              disabled={props.saving}
              placeholder={t('glossary_page.fields.description')}
              onChange={(event) => {
                props.on_change({ info: event.target.value })
              }}
            />
          </label>
          <div className="glossary-page__dialog-field">
            <span className="glossary-page__dialog-label">{t('glossary_page.fields.rule')}</span>
            <BooleanSegmentedToggle
              aria_label={t('glossary_page.fields.rule')}
              value={props.entry.case_sensitive}
              disabled={props.saving}
              on_value_change={(next_value) => {
                props.on_change({ case_sensitive: next_value })
              }}
            />
          </div>
          {props.dirty
            ? <p className="glossary-page__dialog-dirty-tip">{t('glossary_page.toggle.tooltip')}</p>
            : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={props.saving}
            onClick={() => {
              void props.on_query()
            }}
          >
            {t('glossary_page.action.query')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={props.saving}
            onClick={() => {
              void props.on_delete()
            }}
          >
            {t('glossary_page.action.delete')}
          </Button>
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
            {t('glossary_page.action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useI18n, type LocaleKey } from '@/i18n'
import { useSaveShortcut } from '@/hooks/use-save-shortcut'
import type { CustomPromptPresetInputState } from '@/pages/custom-prompt-page/types'
import { Button } from '@/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/shadcn/dialog'
import { Input } from '@/shadcn/input'
import { Kbd } from '@/shadcn/kbd'

type CustomPromptPresetInputDialogProps = {
  state: CustomPromptPresetInputState
  on_change: (next_value: string) => void
  on_submit: () => void
  on_close: () => void
}

type PresetDialogCopy = {
  title_key: LocaleKey
  confirm_key: LocaleKey
}

const PRESET_DIALOG_COPY_BY_MODE: Record<
  NonNullable<CustomPromptPresetInputState['mode']>,
  PresetDialogCopy
> = {
  save: {
    title_key: 'custom_prompt_page.preset.dialog.save_title',
    confirm_key: 'custom_prompt_page.preset.dialog.save_confirm',
  },
  rename: {
    title_key: 'custom_prompt_page.preset.dialog.rename_title',
    confirm_key: 'custom_prompt_page.preset.dialog.rename_confirm',
  },
}

export function CustomPromptPresetInputDialog(
  props: CustomPromptPresetInputDialogProps,
): JSX.Element {
  const { t } = useI18n()
  const dialog_copy = props.state.mode === null
    ? null
    : PRESET_DIALOG_COPY_BY_MODE[props.state.mode]
  const is_save_mode = props.state.mode === 'save'
  const confirm_label = dialog_copy === null ? '' : t(dialog_copy.confirm_key)

  useSaveShortcut({
    enabled: props.state.open && is_save_mode && !props.state.submitting,
    on_save: () => {
      props.on_submit()
    },
  })

  return (
    <Dialog
      open={props.state.open}
      onOpenChange={(next_open) => {
        if (!next_open) {
          props.on_close()
        }
      }}
    >
      <DialogContent size="sm" className="custom-prompt-page__preset-dialog-shell">
        <DialogTitle className="sr-only">
          {dialog_copy === null ? '' : t(dialog_copy.title_key)}
        </DialogTitle>

        <div className="custom-prompt-page__preset-dialog-body">
          <Input
            autoFocus
            value={props.state.value}
            disabled={props.state.submitting}
            placeholder={t('custom_prompt_page.preset.dialog.name_placeholder')}
            onChange={(event) => {
              props.on_change(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                props.on_submit()
              }
            }}
          />
        </div>

        <DialogFooter className="custom-prompt-page__preset-dialog-footer">
          <Button
            type="button"
            variant="outline"
            className="custom-prompt-page__preset-dialog-button"
            disabled={props.state.submitting}
            onClick={props.on_close}
          >
            {t('app.action.cancel')}
          </Button>
          {is_save_mode
            ? (
                <Button
                  type="button"
                  className="custom-prompt-page__preset-dialog-button"
                  disabled={props.state.submitting}
                  onClick={props.on_submit}
                >
                  {confirm_label}
                  <Kbd className="bg-background/18 text-primary-foreground">Ctrl+S</Kbd>
                </Button>
              )
            : (
                <Button
                  type="button"
                  className="custom-prompt-page__preset-dialog-button"
                  disabled={props.state.submitting}
                  onClick={props.on_submit}
                >
                  {confirm_label}
                </Button>
              )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { PencilLine, RefreshCw, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '@/i18n'
import type { ModelEntrySnapshot, ModelThinkingLevel } from '@/pages/model-page/types'
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
import { ScrollArea } from '@/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Textarea } from '@/ui/textarea'
import { SettingCardRow } from '@/widgets/setting-card-row/setting-card-row'

type ModelBasicSettingsDialogProps = {
  open: boolean
  model: ModelEntrySnapshot | null
  readonly: boolean
  onPatch: (patch: Record<string, unknown>) => Promise<void>
  onRequestOpenSelector: () => void
  onRequestTestModel: () => void
  onClose: () => void
}

const THINKING_LEVEL_VALUES: ModelThinkingLevel[] = ['OFF', 'LOW', 'MEDIUM', 'HIGH']

function resolve_thinking_label(
  t: ReturnType<typeof useI18n>['t'],
  thinking_level: ModelThinkingLevel,
): string {
  if (thinking_level === 'LOW') {
    return t('model_page.thinking_level.low')
  } else if (thinking_level === 'MEDIUM') {
    return t('model_page.thinking_level.medium')
  } else if (thinking_level === 'HIGH') {
    return t('model_page.thinking_level.high')
  } else {
    return t('model_page.thinking_level.off')
  }
}

export function ModelBasicSettingsDialog(props: ModelBasicSettingsDialogProps): JSX.Element | null {
  const { t } = useI18n()
  const model_id_input_ref = useRef<HTMLInputElement | null>(null)
  const [model_id_input_value, set_model_id_input_value] = useState('')

  useEffect(() => {
    if (props.model !== null) {
      set_model_id_input_value(props.model.model_id)
    }
  }, [props.model])

  const thinking_level_options = useMemo(() => {
    return THINKING_LEVEL_VALUES.map((thinking_level) => {
      return {
        value: thinking_level,
        label: resolve_thinking_label(t, thinking_level),
      }
    })
  }, [t])

  if (props.model === null) {
    return null
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open) {
          props.onClose()
        }
      }}
    >
      <DialogContent size="lg" className="model-page__dialog-shell">
        <DialogHeader>
          <DialogTitle>{t('model_page.dialog.basic.title')}</DialogTitle>
          <DialogDescription>{t('model_page.dialog.basic.description')}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="model-page__dialog-scroll">
          <div className="model-page__setting-list">
            <SettingCardRow
              title={t('model_page.fields.name.title')}
              description={t('model_page.fields.name.description')}
              action={(
                <Input
                  className="model-page__field model-page__field--md"
                  value={props.model.name}
                  disabled={props.readonly}
                  placeholder={t('model_page.fields.name.placeholder')}
                  onChange={(event) => {
                    void props.onPatch({
                      name: event.target.value.trim(),
                    })
                  }}
                />
              )}
            />

            <SettingCardRow
              title={t('model_page.fields.api_url.title')}
              description={t('model_page.fields.api_url.description')}
              action={(
                <Input
                  className="model-page__field model-page__field--lg"
                  value={props.model.api_url}
                  disabled={props.readonly}
                  placeholder={t('model_page.fields.api_url.placeholder')}
                  onChange={(event) => {
                    void props.onPatch({
                      api_url: event.target.value.trim(),
                    })
                  }}
                />
              )}
            />

            <SettingCardRow
              className="model-page__setting-card-row--block"
              title={t('model_page.fields.api_key.title')}
              description={t('model_page.fields.api_key.description')}
              action={(
                <Textarea
                  className="model-page__textarea"
                  value={props.model.api_key}
                  disabled={props.readonly}
                  placeholder={t('model_page.fields.api_key.placeholder')}
                  onChange={(event) => {
                    void props.onPatch({
                      api_key: event.target.value,
                    })
                  }}
                />
              )}
            />

            <SettingCardRow
              className="model-page__setting-card-row--block"
              title={t('model_page.fields.model_id.title')}
              description={t('model_page.fields.model_id.description').replace('{MODEL}', props.model.model_id)}
              action={(
                <div className="model-page__model-id-field">
                  <Input
                    ref={model_id_input_ref}
                    className="model-page__field model-page__field--lg"
                    value={model_id_input_value}
                    disabled={props.readonly}
                    placeholder={t('model_page.fields.model_id.placeholder')}
                    onChange={(event) => {
                      const next_value = event.target.value
                      set_model_id_input_value(next_value)
                      void props.onPatch({
                        model_id: next_value.trim(),
                      })
                    }}
                  />
                  <div className="model-page__inline-button-group">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={props.readonly}
                      onClick={() => {
                        model_id_input_ref.current?.focus()
                        model_id_input_ref.current?.select()
                      }}
                    >
                      <PencilLine data-icon="inline-start" />
                      {t('model_page.action.input')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={props.readonly}
                      onClick={props.onRequestOpenSelector}
                    >
                      <RefreshCw data-icon="inline-start" />
                      {t('model_page.action.fetch')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={props.readonly}
                      onClick={() => {
                        void props.onRequestTestModel()
                      }}
                    >
                      <Send data-icon="inline-start" />
                      {t('model_page.action.test')}
                    </Button>
                  </div>
                </div>
              )}
            />

            <SettingCardRow
              title={t('model_page.fields.thinking.title')}
              description={t('model_page.fields.thinking.description')}
              action={(
                <Select
                  value={props.model.thinking.level}
                  disabled={props.readonly}
                  onValueChange={(next_value) => {
                    if (
                      next_value === 'OFF'
                      || next_value === 'LOW'
                      || next_value === 'MEDIUM'
                      || next_value === 'HIGH'
                    ) {
                      void props.onPatch({
                        thinking: {
                          level: next_value,
                        },
                      })
                    }
                  }}
                >
                  <SelectTrigger className="model-page__field model-page__field--sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {thinking_level_options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {t('app.action.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

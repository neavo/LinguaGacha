import { useI18n } from '@/i18n'
import type { ModelEntrySnapshot } from '@/pages/model-page/types'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/ui/dialog'
import { Input } from '@/ui/input'
import { SettingCardRow } from '@/widgets/setting-card-row/setting-card-row'

type ModelTaskSettingsDialogProps = {
  open: boolean
  model: ModelEntrySnapshot | null
  readonly: boolean
  onPatch: (patch: Record<string, unknown>) => Promise<void>
  onClose: () => void
}

function normalize_number_input(value: string): number {
  const parsed_value = Number(value)
  if (Number.isFinite(parsed_value)) {
    return parsed_value
  } else {
    return 0
  }
}

export function ModelTaskSettingsDialog(props: ModelTaskSettingsDialogProps): JSX.Element | null {
  const { t } = useI18n()

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
        <div className="model-page__dialog-scroll">
          <div className="model-page__setting-list">
            <SettingCardRow
              title={t('model_page.fields.input_token_limit.title')}
              description={t('model_page.fields.input_token_limit.description')}
              action={(
                <Input
                  className="model-page__field"
                  type="number"
                  disabled={props.readonly}
                  value={props.model.threshold.input_token_limit}
                  onChange={(event) => {
                    void props.onPatch({
                      threshold: {
                        input_token_limit: normalize_number_input(event.target.value),
                      },
                    })
                  }}
                />
              )}
            />

            <SettingCardRow
              title={t('model_page.fields.output_token_limit.title')}
              description={t('model_page.fields.output_token_limit.description')}
              action={(
                <Input
                  className="model-page__field"
                  type="number"
                  disabled={props.readonly}
                  value={props.model.threshold.output_token_limit}
                  onChange={(event) => {
                    void props.onPatch({
                      threshold: {
                        output_token_limit: normalize_number_input(event.target.value),
                      },
                    })
                  }}
                />
              )}
            />

            <SettingCardRow
              title={t('model_page.fields.rpm_limit.title')}
              description={t('model_page.fields.rpm_limit.description')}
              action={(
                <Input
                  className="model-page__field"
                  type="number"
                  disabled={props.readonly}
                  value={props.model.threshold.rpm_limit}
                  onChange={(event) => {
                    void props.onPatch({
                      threshold: {
                        rpm_limit: normalize_number_input(event.target.value),
                      },
                    })
                  }}
                />
              )}
            />

            <SettingCardRow
              title={t('model_page.fields.concurrency_limit.title')}
              description={t('model_page.fields.concurrency_limit.description')}
              action={(
                <Input
                  className="model-page__field"
                  type="number"
                  disabled={props.readonly}
                  value={props.model.threshold.concurrency_limit}
                  onChange={(event) => {
                    void props.onPatch({
                      threshold: {
                        concurrency_limit: normalize_number_input(event.target.value),
                      },
                    })
                  }}
                />
              )}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {t('app.action.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

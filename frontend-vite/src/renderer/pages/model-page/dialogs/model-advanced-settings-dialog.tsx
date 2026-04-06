import { useEffect, useState } from 'react'

import { useI18n } from '@/i18n'
import type { ModelEntrySnapshot } from '@/pages/model-page/types'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/ui/dialog'
import { Slider } from '@/ui/slider'
import { Textarea } from '@/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

type ModelAdvancedSettingsDialogProps = {
  open: boolean
  model: ModelEntrySnapshot | null
  readonly: boolean
  onPatch: (patch: Record<string, unknown>) => Promise<void>
  onJsonFormatError: () => void
  onClose: () => void
}

type JsonParseResult =
  | {
      ok: true
      value: Record<string, unknown>
    }
  | {
      ok: false
    }

type SliderFieldName =
  | 'top_p'
  | 'temperature'
  | 'presence_penalty'
  | 'frequency_penalty'

type SliderFieldConfig = {
  field_name: SliderFieldName
  title_key:
    | 'model_page.fields.top_p.title'
    | 'model_page.fields.temperature.title'
    | 'model_page.fields.presence_penalty.title'
    | 'model_page.fields.frequency_penalty.title'
  description_key:
    | 'model_page.fields.top_p.description'
    | 'model_page.fields.temperature.description'
    | 'model_page.fields.presence_penalty.description'
    | 'model_page.fields.frequency_penalty.description'
  enabled_key:
    | 'top_p_custom_enable'
    | 'temperature_custom_enable'
    | 'presence_penalty_custom_enable'
    | 'frequency_penalty_custom_enable'
  min: number
  max: number
  step: number
}

const SLIDER_FIELD_CONFIGS: SliderFieldConfig[] = [
  {
    field_name: 'top_p',
    title_key: 'model_page.fields.top_p.title',
    description_key: 'model_page.fields.top_p.description',
    enabled_key: 'top_p_custom_enable',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    field_name: 'temperature',
    title_key: 'model_page.fields.temperature.title',
    description_key: 'model_page.fields.temperature.description',
    enabled_key: 'temperature_custom_enable',
    min: 0,
    max: 2,
    step: 0.01,
  },
  {
    field_name: 'presence_penalty',
    title_key: 'model_page.fields.presence_penalty.title',
    description_key: 'model_page.fields.presence_penalty.description',
    enabled_key: 'presence_penalty_custom_enable',
    min: -1,
    max: 1,
    step: 0.01,
  },
  {
    field_name: 'frequency_penalty',
    title_key: 'model_page.fields.frequency_penalty.title',
    description_key: 'model_page.fields.frequency_penalty.description',
    enabled_key: 'frequency_penalty_custom_enable',
    min: -1,
    max: 1,
    step: 0.01,
  },
]

const BOOLEAN_TOGGLE_VALUE = {
  DISABLED: 'disabled',
  ENABLED: 'enabled',
} as const

function parse_request_json_text(value: string): JsonParseResult {
  const trimmed_value = value.trim()
  if (trimmed_value === '') {
    return {
      ok: true,
      value: {},
    }
  }

  try {
    const parsed_value = JSON.parse(trimmed_value) as unknown
    if (typeof parsed_value === 'object' && parsed_value !== null && !Array.isArray(parsed_value)) {
      return {
        ok: true,
        value: parsed_value as Record<string, unknown>,
      }
    } else {
      return {
        ok: false,
      }
    }
  } catch {
    return {
      ok: false,
    }
  }
}

function format_request_json_text(value: Record<string, unknown>): string {
  if (Object.keys(value).length === 0) {
    return ''
  } else {
    return JSON.stringify(value, null, 2)
  }
}

function create_slider_value_state(model: ModelEntrySnapshot | null): Record<SliderFieldName, number> {
  if (model === null) {
    return {
      top_p: 0,
      temperature: 0,
      presence_penalty: 0,
      frequency_penalty: 0,
    }
  } else {
    return {
      top_p: model.generation.top_p,
      temperature: model.generation.temperature,
      presence_penalty: model.generation.presence_penalty,
      frequency_penalty: model.generation.frequency_penalty,
    }
  }
}

function resolve_boolean_toggle_value(current_value: boolean): string {
  if (current_value) {
    return BOOLEAN_TOGGLE_VALUE.ENABLED
  } else {
    return BOOLEAN_TOGGLE_VALUE.DISABLED
  }
}

export function ModelAdvancedSettingsDialog(props: ModelAdvancedSettingsDialogProps): JSX.Element | null {
  const { t } = useI18n()
  const [headers_text, set_headers_text] = useState('')
  const [body_text, set_body_text] = useState('')
  const [headers_error, set_headers_error] = useState(false)
  const [body_error, set_body_error] = useState(false)
  const [slider_values, set_slider_values] = useState<Record<SliderFieldName, number>>(
    create_slider_value_state(props.model),
  )

  useEffect(() => {
    if (props.model !== null) {
      set_headers_text(format_request_json_text(props.model.request.extra_headers))
      set_body_text(format_request_json_text(props.model.request.extra_body))
      set_headers_error(false)
      set_body_error(false)
    }
  }, [props.model])

  useEffect(() => {
    set_slider_values(create_slider_value_state(props.model))
  }, [props.model])

  if (props.model === null) {
    return null
  }

  const model = props.model

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
            {SLIDER_FIELD_CONFIGS.map((field_config) => {
              const current_value = slider_values[field_config.field_name] ?? 0
              const current_enabled = Boolean(model.generation[field_config.enabled_key])

              return (
                <Card key={field_config.field_name}>
                  <CardContent className="model-page__advanced-card-content">
                    <div className="model-page__advanced-card-head">
                      <div className="model-page__advanced-card-copy">
                        <CardTitle>{t(field_config.title_key)}</CardTitle>
                        <CardDescription>{t(field_config.description_key)}</CardDescription>
                      </div>

                      <div className="model-page__advanced-inline-control">
                        {current_enabled
                          ? (
                              <div className="model-page__slider-control">
                                <div className="model-page__slider-wrap model-page__field--md">
                                  <span className="model-page__slider-value">{current_value.toFixed(2)}</span>
                                  <Slider
                                    min={field_config.min}
                                    max={field_config.max}
                                    step={field_config.step}
                                    disabled={props.readonly}
                                    value={[current_value]}
                                    onValueChange={(next_value) => {
                                      const preview_value = next_value[0]
                                      if (preview_value !== undefined) {
                                        set_slider_values((previous_state) => {
                                          return {
                                            ...previous_state,
                                            [field_config.field_name]: preview_value,
                                          }
                                        })
                                      }
                                    }}
                                    onValueCommit={(next_value) => {
                                      const committed_value = next_value[0]
                                      if (committed_value !== undefined) {
                                        void props.onPatch({
                                          generation: {
                                            [field_config.field_name]: committed_value,
                                          },
                                        })
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            )
                          : null}

                        <ToggleGroup
                          type="single"
                          variant="segmented"
                          className="model-page__advanced-toggle-group"
                          aria-label={t(field_config.title_key)}
                          value={resolve_boolean_toggle_value(current_enabled)}
                          disabled={props.readonly}
                          onValueChange={(next_value) => {
                            if (next_value === BOOLEAN_TOGGLE_VALUE.DISABLED) {
                              void props.onPatch({
                                generation: {
                                  [field_config.enabled_key]: false,
                                },
                              })
                            } else if (next_value === BOOLEAN_TOGGLE_VALUE.ENABLED) {
                              void props.onPatch({
                                generation: {
                                  [field_config.enabled_key]: true,
                                },
                              })
                            }
                          }}
                        >
                          <ToggleGroupItem
                            className="model-page__advanced-toggle-item"
                            value={BOOLEAN_TOGGLE_VALUE.DISABLED}
                          >
                            {t('app.toggle.disabled')}
                          </ToggleGroupItem>
                          <ToggleGroupItem
                            className="model-page__advanced-toggle-item"
                            value={BOOLEAN_TOGGLE_VALUE.ENABLED}
                          >
                            {t('app.toggle.enabled')}
                          </ToggleGroupItem>
                        </ToggleGroup>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}

            <Card>
              <CardContent className="model-page__advanced-card-content">
                <div className="model-page__advanced-card-head">
                  <div className="model-page__advanced-card-copy">
                    <CardTitle>{t('model_page.fields.extra_headers.title')}</CardTitle>
                    <CardDescription>{t('model_page.fields.extra_headers.description')}</CardDescription>
                  </div>

                  <ToggleGroup
                    type="single"
                    variant="segmented"
                    className="model-page__advanced-toggle-group"
                    aria-label={t('model_page.fields.extra_headers.title')}
                    value={resolve_boolean_toggle_value(model.request.extra_headers_custom_enable)}
                    disabled={props.readonly}
                    onValueChange={(next_value) => {
                      if (next_value === BOOLEAN_TOGGLE_VALUE.DISABLED) {
                        void props.onPatch({
                          request: {
                            extra_headers_custom_enable: false,
                          },
                        })
                      } else if (next_value === BOOLEAN_TOGGLE_VALUE.ENABLED) {
                        void props.onPatch({
                          request: {
                            extra_headers_custom_enable: true,
                          },
                        })
                      }
                    }}
                  >
                    <ToggleGroupItem
                      className="model-page__advanced-toggle-item"
                      value={BOOLEAN_TOGGLE_VALUE.DISABLED}
                    >
                      {t('app.toggle.disabled')}
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      className="model-page__advanced-toggle-item"
                      value={BOOLEAN_TOGGLE_VALUE.ENABLED}
                    >
                      {t('app.toggle.enabled')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className="model-page__request-editor">
                  <Textarea
                    className="model-page__textarea"
                    value={headers_text}
                    disabled={props.readonly || !model.request.extra_headers_custom_enable}
                    aria-invalid={headers_error || undefined}
                    placeholder={t('model_page.fields.extra_headers.placeholder')}
                    onChange={(event) => {
                      set_headers_text(event.target.value)
                    }}
                    onBlur={() => {
                      const parsed_result = parse_request_json_text(headers_text)
                      if (parsed_result.ok) {
                        set_headers_error(false)
                        void props.onPatch({
                          request: {
                            extra_headers: parsed_result.value,
                          },
                        })
                      } else {
                        set_headers_error(true)
                        props.onJsonFormatError()
                      }
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="model-page__advanced-card-content">
                <div className="model-page__advanced-card-head">
                  <div className="model-page__advanced-card-copy">
                    <CardTitle>{t('model_page.fields.extra_body.title')}</CardTitle>
                    <CardDescription>{t('model_page.fields.extra_body.description')}</CardDescription>
                  </div>

                  <ToggleGroup
                    type="single"
                    variant="segmented"
                    className="model-page__advanced-toggle-group"
                    aria-label={t('model_page.fields.extra_body.title')}
                    value={resolve_boolean_toggle_value(model.request.extra_body_custom_enable)}
                    disabled={props.readonly}
                    onValueChange={(next_value) => {
                      if (next_value === BOOLEAN_TOGGLE_VALUE.DISABLED) {
                        void props.onPatch({
                          request: {
                            extra_body_custom_enable: false,
                          },
                        })
                      } else if (next_value === BOOLEAN_TOGGLE_VALUE.ENABLED) {
                        void props.onPatch({
                          request: {
                            extra_body_custom_enable: true,
                          },
                        })
                      }
                    }}
                  >
                    <ToggleGroupItem
                      className="model-page__advanced-toggle-item"
                      value={BOOLEAN_TOGGLE_VALUE.DISABLED}
                    >
                      {t('app.toggle.disabled')}
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      className="model-page__advanced-toggle-item"
                      value={BOOLEAN_TOGGLE_VALUE.ENABLED}
                    >
                      {t('app.toggle.enabled')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className="model-page__request-editor">
                  <Textarea
                    className="model-page__textarea"
                    value={body_text}
                    disabled={props.readonly || !model.request.extra_body_custom_enable}
                    aria-invalid={body_error || undefined}
                    placeholder={t('model_page.fields.extra_body.placeholder')}
                    onChange={(event) => {
                      set_body_text(event.target.value)
                    }}
                    onBlur={() => {
                      const parsed_result = parse_request_json_text(body_text)
                      if (parsed_result.ok) {
                        set_body_error(false)
                        void props.onPatch({
                          request: {
                            extra_body: parsed_result.value,
                          },
                        })
                      } else {
                        set_body_error(true)
                        props.onJsonFormatError()
                      }
                    }}
                  />
                </div>
              </CardContent>
            </Card>
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

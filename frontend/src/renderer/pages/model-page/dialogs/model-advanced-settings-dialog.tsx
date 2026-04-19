import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import type { ModelEntrySnapshot } from "@/pages/model-page/types";
import { Card, CardContent, CardDescription, CardTitle } from "@/shadcn/card";
import { Input } from "@/shadcn/input";
import { Textarea } from "@/shadcn/textarea";
import { AppPageDialog } from "@/widgets/app-page-dialog/app-page-dialog";
import { SegmentedToggle } from "@/widgets/segmented-toggle/segmented-toggle";

type ModelAdvancedSettingsDialogProps = {
  open: boolean;
  model: ModelEntrySnapshot | null;
  readonly: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onJsonFormatError: () => void;
  onClose: () => void;
};

type JsonParseResult =
  | {
      ok: true;
      value: Record<string, unknown>;
    }
  | {
      ok: false;
    };

type SliderFieldName =
  | "top_p"
  | "temperature"
  | "presence_penalty"
  | "frequency_penalty";

type SliderFieldConfig = {
  field_name: SliderFieldName;
  title_key:
    | "model_page.fields.top_p.title"
    | "model_page.fields.temperature.title"
    | "model_page.fields.presence_penalty.title"
    | "model_page.fields.frequency_penalty.title";
  description_key:
    | "model_page.fields.top_p.description"
    | "model_page.fields.temperature.description"
    | "model_page.fields.presence_penalty.description"
    | "model_page.fields.frequency_penalty.description";
  enabled_key:
    | "top_p_custom_enable"
    | "temperature_custom_enable"
    | "presence_penalty_custom_enable"
    | "frequency_penalty_custom_enable";
  min: number;
  max: number;
  step: number;
};

const SLIDER_FIELD_CONFIGS: SliderFieldConfig[] = [
  {
    field_name: "top_p",
    title_key: "model_page.fields.top_p.title",
    description_key: "model_page.fields.top_p.description",
    enabled_key: "top_p_custom_enable",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    field_name: "temperature",
    title_key: "model_page.fields.temperature.title",
    description_key: "model_page.fields.temperature.description",
    enabled_key: "temperature_custom_enable",
    min: 0,
    max: 2,
    step: 0.01,
  },
  {
    field_name: "presence_penalty",
    title_key: "model_page.fields.presence_penalty.title",
    description_key: "model_page.fields.presence_penalty.description",
    enabled_key: "presence_penalty_custom_enable",
    min: -1,
    max: 1,
    step: 0.01,
  },
  {
    field_name: "frequency_penalty",
    title_key: "model_page.fields.frequency_penalty.title",
    description_key: "model_page.fields.frequency_penalty.description",
    enabled_key: "frequency_penalty_custom_enable",
    min: -1,
    max: 1,
    step: 0.01,
  },
];

function parse_request_json_text(value: string): JsonParseResult {
  const trimmed_value = value.trim();
  if (trimmed_value === "") {
    return {
      ok: true,
      value: {},
    };
  }

  try {
    const parsed_value = JSON.parse(trimmed_value) as unknown;
    if (
      typeof parsed_value === "object" &&
      parsed_value !== null &&
      !Array.isArray(parsed_value)
    ) {
      return {
        ok: true,
        value: parsed_value as Record<string, unknown>,
      };
    } else {
      return {
        ok: false,
      };
    }
  } catch {
    return {
      ok: false,
    };
  }
}

function format_request_json_text(value: Record<string, unknown>): string {
  if (Object.keys(value).length === 0) {
    return "";
  } else {
    return JSON.stringify(value, null, 2);
  }
}

function create_slider_value_state(
  model: ModelEntrySnapshot | null,
): Record<SliderFieldName, number> {
  if (model === null) {
    return {
      top_p: 0,
      temperature: 0,
      presence_penalty: 0,
      frequency_penalty: 0,
    };
  } else {
    return {
      top_p: model.generation.top_p,
      temperature: model.generation.temperature,
      presence_penalty: model.generation.presence_penalty,
      frequency_penalty: model.generation.frequency_penalty,
    };
  }
}

function create_slider_text_state(
  model: ModelEntrySnapshot | null,
): Record<SliderFieldName, string> {
  const slider_value_state = create_slider_value_state(model);

  return {
    top_p: slider_value_state.top_p.toFixed(2),
    temperature: slider_value_state.temperature.toFixed(2),
    presence_penalty: slider_value_state.presence_penalty.toFixed(2),
    frequency_penalty: slider_value_state.frequency_penalty.toFixed(2),
  };
}

function normalize_slider_value(
  field_config: SliderFieldConfig,
  raw_value: number,
): number {
  const clamped_value = Math.min(
    field_config.max,
    Math.max(field_config.min, raw_value),
  );
  const step_count = Math.round(
    (clamped_value - field_config.min) / field_config.step,
  );
  return Number((field_config.min + step_count * field_config.step).toFixed(2));
}

export function ModelAdvancedSettingsDialog(
  props: ModelAdvancedSettingsDialogProps,
): JSX.Element | null {
  const { t } = useI18n();
  const boolean_segmented_options = [
    {
      value: "disabled",
      label: t("app.toggle.disabled"),
    },
    {
      value: "enabled",
      label: t("app.toggle.enabled"),
    },
  ] as const;
  const [headers_text, set_headers_text] = useState("");
  const [body_text, set_body_text] = useState("");
  const [headers_error, set_headers_error] = useState(false);
  const [body_error, set_body_error] = useState(false);
  const [slider_values, set_slider_values] = useState<
    Record<SliderFieldName, number>
  >(create_slider_value_state(props.model));
  const [slider_texts, set_slider_texts] = useState<
    Record<SliderFieldName, string>
  >(create_slider_text_state(props.model));

  useEffect(() => {
    if (props.model !== null) {
      set_headers_text(
        format_request_json_text(props.model.request.extra_headers),
      );
      set_body_text(format_request_json_text(props.model.request.extra_body));
      set_headers_error(false);
      set_body_error(false);
    }
  }, [props.model]);

  useEffect(() => {
    set_slider_values(create_slider_value_state(props.model));
    set_slider_texts(create_slider_text_state(props.model));
  }, [props.model]);

  if (props.model === null) {
    return null;
  }

  const model = props.model;

  return (
    <AppPageDialog
      open={props.open}
      title={t("model_page.action.advanced_settings")}
      size="lg"
      onClose={props.onClose}
      bodyClassName="overflow-hidden p-0"
    >
      <div className="model-page__dialog-scroll">
        <div className="model-page__setting-list">
          {SLIDER_FIELD_CONFIGS.map((field_config) => {
            const current_value = slider_values[field_config.field_name] ?? 0;
            const current_text =
              slider_texts[field_config.field_name] ?? current_value.toFixed(2);
            const current_enabled = Boolean(
              model.generation[field_config.enabled_key],
            );

            return (
              <Card key={field_config.field_name}>
                <CardContent className="model-page__advanced-card-content">
                  <div className="model-page__advanced-card-head">
                    <div className="model-page__advanced-card-copy">
                      <CardTitle>{t(field_config.title_key)}</CardTitle>
                      <CardDescription>
                        {t(field_config.description_key)}
                      </CardDescription>
                    </div>

                    <div className="model-page__advanced-inline-control">
                      {current_enabled ? (
                        <div className="model-page__advanced-number-field">
                          <Input
                            type="number"
                            min={field_config.min}
                            max={field_config.max}
                            step={field_config.step}
                            inputMode="decimal"
                            value={current_text}
                            disabled={props.readonly}
                            onChange={(event) => {
                              const next_text = event.target.value;
                              set_slider_texts((previous_state) => {
                                return {
                                  ...previous_state,
                                  [field_config.field_name]: next_text,
                                };
                              });
                            }}
                            onBlur={() => {
                              const trimmed_text = current_text.trim();
                              const parsed_value = Number(trimmed_text);
                              if (
                                trimmed_text !== "" &&
                                Number.isFinite(parsed_value)
                              ) {
                                const normalized_value = normalize_slider_value(
                                  field_config,
                                  parsed_value,
                                );
                                set_slider_values((previous_state) => {
                                  return {
                                    ...previous_state,
                                    [field_config.field_name]: normalized_value,
                                  };
                                });
                                set_slider_texts((previous_state) => {
                                  return {
                                    ...previous_state,
                                    [field_config.field_name]:
                                      normalized_value.toFixed(2),
                                  };
                                });

                                if (normalized_value !== current_value) {
                                  void props.onPatch({
                                    generation: {
                                      [field_config.field_name]:
                                        normalized_value,
                                    },
                                  });
                                }
                              } else {
                                set_slider_texts((previous_state) => {
                                  return {
                                    ...previous_state,
                                    [field_config.field_name]:
                                      current_value.toFixed(2),
                                  };
                                });
                              }
                            }}
                          />
                        </div>
                      ) : null}

                      <SegmentedToggle
                        aria_label={t(field_config.title_key)}
                        size="sm"
                        value={current_enabled ? "enabled" : "disabled"}
                        options={boolean_segmented_options}
                        className="model-page__advanced-toggle-group"
                        stretch
                        disabled={props.readonly}
                        on_value_change={(next_value) => {
                          void props.onPatch({
                            generation: {
                              [field_config.enabled_key]:
                                next_value === "enabled",
                            },
                          });
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <Card>
            <CardContent className="model-page__advanced-card-content">
              <div className="model-page__advanced-card-head">
                <div className="model-page__advanced-card-copy">
                  <CardTitle>
                    {t("model_page.fields.extra_headers.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("model_page.fields.extra_headers.description")}
                  </CardDescription>
                </div>

                <div className="model-page__advanced-inline-control">
                  <SegmentedToggle
                    aria_label={t("model_page.fields.extra_headers.title")}
                    size="sm"
                    value={
                      model.request.extra_headers_custom_enable
                        ? "enabled"
                        : "disabled"
                    }
                    options={boolean_segmented_options}
                    className="model-page__advanced-toggle-group"
                    stretch
                    disabled={props.readonly}
                    on_value_change={(next_value) => {
                      void props.onPatch({
                        request: {
                          extra_headers_custom_enable: next_value === "enabled",
                        },
                      });
                    }}
                  />
                </div>
              </div>

              <div className="model-page__request-editor">
                <Textarea
                  className="model-page__textarea"
                  value={headers_text}
                  disabled={
                    props.readonly || !model.request.extra_headers_custom_enable
                  }
                  aria-invalid={headers_error || undefined}
                  placeholder={t("model_page.fields.extra_headers.placeholder")}
                  onChange={(event) => {
                    set_headers_text(event.target.value);
                  }}
                  onBlur={() => {
                    const parsed_result = parse_request_json_text(headers_text);
                    if (parsed_result.ok) {
                      set_headers_error(false);
                      void props.onPatch({
                        request: {
                          extra_headers: parsed_result.value,
                        },
                      });
                    } else {
                      set_headers_error(true);
                      props.onJsonFormatError();
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
                  <CardTitle>
                    {t("model_page.fields.extra_body.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("model_page.fields.extra_body.description")}
                  </CardDescription>
                </div>

                <div className="model-page__advanced-inline-control">
                  <SegmentedToggle
                    aria_label={t("model_page.fields.extra_body.title")}
                    size="sm"
                    value={
                      model.request.extra_body_custom_enable
                        ? "enabled"
                        : "disabled"
                    }
                    options={boolean_segmented_options}
                    className="model-page__advanced-toggle-group"
                    stretch
                    disabled={props.readonly}
                    on_value_change={(next_value) => {
                      void props.onPatch({
                        request: {
                          extra_body_custom_enable: next_value === "enabled",
                        },
                      });
                    }}
                  />
                </div>
              </div>

              <div className="model-page__request-editor">
                <Textarea
                  className="model-page__textarea"
                  value={body_text}
                  disabled={
                    props.readonly || !model.request.extra_body_custom_enable
                  }
                  aria-invalid={body_error || undefined}
                  placeholder={t("model_page.fields.extra_body.placeholder")}
                  onChange={(event) => {
                    set_body_text(event.target.value);
                  }}
                  onBlur={() => {
                    const parsed_result = parse_request_json_text(body_text);
                    if (parsed_result.ok) {
                      set_body_error(false);
                      void props.onPatch({
                        request: {
                          extra_body: parsed_result.value,
                        },
                      });
                    } else {
                      set_body_error(true);
                      props.onJsonFormatError();
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppPageDialog>
  );
}

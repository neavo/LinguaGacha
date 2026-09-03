import { useEffect, useState } from "react";

import {
  normalize_model_agent_config,
  type ModelAgentConfig,
  type NormalizedModelAgentConfig,
} from "@domain/model-agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { Card, CardContent, CardDescription, CardTitle } from "@frontend/shadcn/card";
import { Input } from "@frontend/shadcn/input";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

type ModelAdvancedSettingsDialogProps = {
  open: boolean;
  model: ModelEntrySnapshot | null;
  readonly: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onAgentLimitsAdjusted: () => void;
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

type SliderFieldName = "top_p" | "temperature";
type AgentLimitFieldName = keyof ModelAgentConfig;
type RequestJsonFieldName = "extra_headers" | "extra_body";

type RequestJsonDraft = {
  text: string;
  invalid: boolean;
};

/** 两项 Agent 容量固定置于高级设置顶部并共享草稿流程。 */
const AGENT_LIMIT_FIELDS = [
  {
    field_name: "context_window",
    title_key: "model_page.fields.context_window.title",
    description_key: "model_page.fields.context_window.description",
  },
  {
    field_name: "max_output_tokens",
    title_key: "model_page.fields.max_output_tokens.title",
    description_key: "model_page.fields.max_output_tokens.description",
  },
] as const;

type SliderFieldConfig = {
  field_name: SliderFieldName;
  title_key: "model_page.fields.top_p.title" | "model_page.fields.temperature.title";
  description_key:
    | "model_page.fields.top_p.description"
    | "model_page.fields.temperature.description";
  enabled_key: "top_p_custom_enable" | "temperature_custom_enable";
  min: number;
  max: number;
  step: number;
};

/** 两个生成参数共用同一渲染与归一流程，差异只保留在字段配置。 */
const SLIDER_FIELD_CONFIGS = [
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
] as const satisfies readonly SliderFieldConfig[];

/** 自定义请求 JSON 字段共用编辑、启用与展示配置。 */
const REQUEST_JSON_FIELD_CONFIGS = [
  {
    field_name: "extra_headers",
    enabled_field_name: "extra_headers_custom_enable",
    title_key: "model_page.fields.extra_headers.title",
    description_key: "model_page.fields.extra_headers.description",
    placeholder_key: "model_page.fields.extra_headers.placeholder",
  },
  {
    field_name: "extra_body",
    enabled_field_name: "extra_body_custom_enable",
    title_key: "model_page.fields.extra_body.title",
    description_key: "model_page.fields.extra_body.description",
    placeholder_key: "model_page.fields.extra_body.placeholder",
  },
] as const;

/** 把用户输入收窄为 JSON object；空文本等价于空配置。 */
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
    if (typeof parsed_value === "object" && parsed_value !== null && !Array.isArray(parsed_value)) {
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

/** 只在非空配置时展示格式化 JSON，避免空对象噪声。 */
function format_request_json_text(value: Record<string, unknown>): string {
  if (Object.keys(value).length === 0) {
    return "";
  } else {
    return JSON.stringify(value, null, 2);
  }
}

/** 从当前模型构造两个请求 JSON 编辑器的草稿。 */
function create_request_json_drafts(
  model: ModelEntrySnapshot | null,
): Record<RequestJsonFieldName, RequestJsonDraft> {
  return {
    extra_headers: {
      text: format_request_json_text(model?.request.extra_headers ?? {}),
      invalid: false,
    },
    extra_body: {
      text: format_request_json_text(model?.request.extra_body ?? {}),
      invalid: false,
    },
  };
}

/** 从当前模型构造所有滑块的数值状态。 */
function create_slider_value_state(
  model: ModelEntrySnapshot | null,
): Record<SliderFieldName, number> {
  if (model === null) {
    return {
      top_p: 0,
      temperature: 0,
    };
  } else {
    return {
      top_p: model.generation.top_p,
      temperature: model.generation.temperature,
    };
  }
}

/** 为允许临时无效输入的数字框构造独立文本状态。 */
function create_slider_text_state(
  model: ModelEntrySnapshot | null,
): Record<SliderFieldName, string> {
  const slider_value_state = create_slider_value_state(model);

  return {
    top_p: slider_value_state.top_p.toFixed(2),
    temperature: slider_value_state.temperature.toFixed(2),
  };
}

/** 按字段边界和步长归一用户输入。 */
function normalize_slider_value(field_config: SliderFieldConfig, raw_value: number): number {
  const clamped_value = Math.min(field_config.max, Math.max(field_config.min, raw_value));
  const step_count = Math.round((clamped_value - field_config.min) / field_config.step);
  return Number((field_config.min + step_count * field_config.step).toFixed(2));
}

/** 为允许空值和中间态的两个容量输入构造文本草稿。 */
function create_agent_limit_draft(
  model: ModelEntrySnapshot | null,
): Record<AgentLimitFieldName, string> {
  return {
    context_window: model?.agent.context_window.toString() ?? "",
    max_output_tokens: model?.agent.max_output_tokens.toString() ?? "",
  };
}

/** 两项草稿共用领域规范化，避免前端维护第二套数值关系。 */
function resolve_agent_limit_draft(
  draft: Record<AgentLimitFieldName, string>,
): NormalizedModelAgentConfig {
  const context_window_text = draft.context_window.trim();
  const max_output_tokens_text = draft.max_output_tokens.trim();
  return normalize_model_agent_config({
    context_window: context_window_text === "" ? null : Number(context_window_text),
    max_output_tokens: max_output_tokens_text === "" ? null : Number(max_output_tokens_text),
  });
}

/** 编辑协议支持的生成参数与自定义请求字段。 */
export function ModelAdvancedSettingsDialog(
  props: ModelAdvancedSettingsDialogProps,
): JSX.Element | null {
  const { t } = useI18n();
  const [request_json_drafts, set_request_json_drafts] = useState(
    create_request_json_drafts(props.model),
  );
  const [agent_limit_draft, set_agent_limit_draft] = useState(
    create_agent_limit_draft(props.model),
  );
  const [slider_values, set_slider_values] = useState<Record<SliderFieldName, number>>(
    create_slider_value_state(props.model),
  );
  const [slider_texts, set_slider_texts] = useState<Record<SliderFieldName, string>>(
    create_slider_text_state(props.model),
  );

  useEffect(() => {
    if (props.model !== null) {
      set_request_json_drafts(create_request_json_drafts(props.model));
      set_agent_limit_draft(create_agent_limit_draft(props.model));
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

  /** 两个 JSON 编辑器共用同一解析、错误和提交语义。 */
  function commit_request_json(field_name: RequestJsonFieldName): void {
    const parsed_result = parse_request_json_text(request_json_drafts[field_name].text);
    set_request_json_drafts((previous_drafts) => ({
      ...previous_drafts,
      [field_name]: {
        ...previous_drafts[field_name],
        invalid: !parsed_result.ok,
      },
    }));
    if (!parsed_result.ok) {
      props.onJsonFormatError();
      return;
    }

    void props.onPatch({ request: { [field_name]: parsed_result.value } });
  }

  /** 两项容量必须作为一组规范化和保存，避免产生瞬时非法组合。 */
  function commit_agent_limits(): void {
    const resolved = resolve_agent_limit_draft(agent_limit_draft);
    set_agent_limit_draft({
      context_window: resolved.config.context_window.toString(),
      max_output_tokens: resolved.config.max_output_tokens.toString(),
    });
    if (resolved.adjusted) {
      props.onAgentLimitsAdjusted();
    }
    save_agent_limits(resolved.config);
  }

  /** 只提交与当前模型不同的完整容量配置。 */
  function save_agent_limits(candidate: ModelAgentConfig): void {
    if (
      candidate.context_window !== model.agent.context_window ||
      candidate.max_output_tokens !== model.agent.max_output_tokens
    ) {
      void props.onPatch({ agent: candidate });
    }
  }

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
          {AGENT_LIMIT_FIELDS.map((field_config) => (
            <SettingCardRow
              key={field_config.field_name}
              title={t(field_config.title_key)}
              description={t(field_config.description_key)}
              action={
                <Input
                  className="model-page__field"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={agent_limit_draft[field_config.field_name]}
                  disabled={props.readonly}
                  aria-label={t(field_config.title_key)}
                  onChange={(event) => {
                    set_agent_limit_draft({
                      ...agent_limit_draft,
                      [field_config.field_name]: event.target.value,
                    });
                  }}
                  onBlur={commit_agent_limits}
                />
              }
            />
          ))}

          {SLIDER_FIELD_CONFIGS.map((field_config) => {
            const current_value = slider_values[field_config.field_name] ?? 0;
            const current_text = slider_texts[field_config.field_name] ?? current_value.toFixed(2);
            const current_enabled = Boolean(model.generation[field_config.enabled_key]);

            return (
              <Card key={field_config.field_name}>
                <CardContent className="model-page__advanced-card-content">
                  <div className="model-page__advanced-card-head">
                    <div className="model-page__advanced-card-copy">
                      <CardTitle>{t(field_config.title_key)}</CardTitle>
                      <CardDescription>{t(field_config.description_key)}</CardDescription>
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
                              if (trimmed_text !== "" && Number.isFinite(parsed_value)) {
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
                                    [field_config.field_name]: normalized_value.toFixed(2),
                                  };
                                });

                                if (normalized_value !== current_value) {
                                  void props.onPatch({
                                    generation: {
                                      [field_config.field_name]: normalized_value,
                                    },
                                  });
                                }
                              } else {
                                set_slider_texts((previous_state) => {
                                  return {
                                    ...previous_state,
                                    [field_config.field_name]: current_value.toFixed(2),
                                  };
                                });
                              }
                            }}
                          />
                        </div>
                      ) : null}

                      <BooleanSegmentedToggle
                        aria_label={t(field_config.title_key)}
                        value={current_enabled}
                        className="model-page__advanced-toggle-group"
                        stretch
                        disabled={props.readonly}
                        on_value_change={(next_value) => {
                          void props.onPatch({
                            generation: {
                              [field_config.enabled_key]: next_value,
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

          {REQUEST_JSON_FIELD_CONFIGS.map((field_config) => {
            const draft = request_json_drafts[field_config.field_name];
            const enabled = model.request[field_config.enabled_field_name];
            const read_only = props.readonly || !enabled;

            return (
              <Card key={field_config.field_name}>
                <CardContent className="model-page__advanced-card-content">
                  <div className="model-page__advanced-card-head">
                    <div className="model-page__advanced-card-copy">
                      <CardTitle>{t(field_config.title_key)}</CardTitle>
                      <CardDescription>{t(field_config.description_key)}</CardDescription>
                    </div>

                    <div className="model-page__advanced-inline-control">
                      <BooleanSegmentedToggle
                        aria_label={t(field_config.title_key)}
                        value={enabled}
                        className="model-page__advanced-toggle-group"
                        stretch
                        disabled={props.readonly}
                        on_value_change={(next_value) => {
                          void props.onPatch({
                            request: {
                              [field_config.enabled_field_name]: next_value,
                            },
                          });
                        }}
                      />
                    </div>
                  </div>

                  <div className="model-page__request-editor">
                    <AppEditor
                      class_name="model-page__request-editor-control"
                      syntax="json"
                      value={draft.text}
                      placeholder={t(field_config.placeholder_key)}
                      aria_label={t(field_config.title_key)}
                      read_only={read_only}
                      invalid={draft.invalid}
                      on_change={(next_value) => {
                        set_request_json_drafts((previous_drafts) => ({
                          ...previous_drafts,
                          [field_config.field_name]: {
                            text: next_value,
                            invalid: false,
                          },
                        }));
                      }}
                      on_blur={
                        read_only ? undefined : () => commit_request_json(field_config.field_name)
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppPageDialog>
  );
}

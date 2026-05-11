import { PencilLine, RefreshCw, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/i18n";
import type { ModelEntrySnapshot, ModelThinkingLevel } from "@/pages/model-page/types";
import { AppButton } from "@/widgets/app-button/app-button";
import { Input } from "@/shadcn/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/select";
import { Textarea } from "@/shadcn/textarea";
import { AppPageDialog } from "@/widgets/app-page-dialog/app-page-dialog";
import { SettingHelpButton } from "@/widgets/setting-help-button/setting-help-button";
import { SettingCardRow } from "@/widgets/setting-card-row/setting-card-row";

type ModelBasicSettingsDialogProps = {
  open: boolean;
  model: ModelEntrySnapshot | null;
  readonly: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onRequestOpenSelector: () => void;
  onRequestTestModel: () => void;
  onClose: () => void;
};

const THINKING_LEVEL_VALUES: ModelThinkingLevel[] = ["OFF", "LOW", "MEDIUM", "HIGH"];
const THINKING_SUPPORT_URL_BY_LOCALE = {
  "zh-CN": "https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupport",
  "en-US": "https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupportEN",
} as const;
const CONNECTION_FIELD_API_FORMATS = ["OpenAI", "Google", "Anthropic", "SakuraLLM"] as const;
const THINKING_FIELD_API_FORMATS = ["OpenAI", "Google", "Anthropic"] as const;

function resolve_thinking_label(
  t: ReturnType<typeof useI18n>["t"],
  thinking_level: ModelThinkingLevel,
): string {
  if (thinking_level === "LOW") {
    return t("model_page.thinking_level.low");
  } else if (thinking_level === "MEDIUM") {
    return t("model_page.thinking_level.medium");
  } else if (thinking_level === "HIGH") {
    return t("model_page.thinking_level.high");
  } else {
    return t("model_page.thinking_level.off");
  }
}

function should_show_connection_fields(api_format: string): boolean {
  return CONNECTION_FIELD_API_FORMATS.includes(
    api_format as (typeof CONNECTION_FIELD_API_FORMATS)[number],
  );
}

function should_show_thinking_field(api_format: string): boolean {
  return THINKING_FIELD_API_FORMATS.includes(
    api_format as (typeof THINKING_FIELD_API_FORMATS)[number],
  );
}

export function ModelBasicSettingsDialog(props: ModelBasicSettingsDialogProps): JSX.Element | null {
  const { locale, t } = useI18n();
  const [is_model_id_editor_open, set_is_model_id_editor_open] = useState(false);
  const [model_id_input_value, set_model_id_input_value] = useState("");

  useEffect(() => {
    if (props.model !== null) {
      set_model_id_input_value(props.model.model_id);
    }
  }, [props.model]);

  useEffect(() => {
    if (!props.open) {
      set_is_model_id_editor_open(false);
    }
  }, [props.open]);

  const thinking_level_options = useMemo(() => {
    return THINKING_LEVEL_VALUES.map((thinking_level) => {
      return {
        value: thinking_level,
        label: resolve_thinking_label(t, thinking_level),
      };
    });
  }, [t]);

  if (props.model === null) {
    return null;
  }

  const model = props.model;
  const show_connection_fields = should_show_connection_fields(model.api_format);
  const show_thinking_field = should_show_thinking_field(model.api_format);

  async function commit_model_id_input(): Promise<void> {
    await props.onPatch({
      model_id: model_id_input_value.trim(),
    });
    set_is_model_id_editor_open(false);
  }

  return (
    <>
      <AppPageDialog
        open={props.open}
        title={t("model_page.action.basic_settings")}
        size="lg"
        onClose={props.onClose}
        bodyClassName="overflow-hidden p-0"
      >
        <div className="model-page__dialog-scroll">
          <div className="model-page__setting-list">
            <SettingCardRow
              title={t("model_page.fields.name.title")}
              description={t("model_page.fields.name.description")}
              action={
                <Input
                  className="model-page__field model-page__field--md"
                  value={model.name}
                  disabled={props.readonly}
                  placeholder={t("model_page.fields.name.placeholder")}
                  onChange={(event) => {
                    void props.onPatch({
                      name: event.target.value.trim(),
                    });
                  }}
                />
              }
            />

            {show_connection_fields ? (
              <>
                <SettingCardRow
                  title={t("model_page.fields.api_url.title")}
                  description={t("model_page.fields.api_url.description")}
                  action={
                    <Input
                      className="model-page__field model-page__field--lg"
                      value={model.api_url}
                      disabled={props.readonly}
                      placeholder={t("model_page.fields.api_url.placeholder")}
                      onChange={(event) => {
                        void props.onPatch({
                          api_url: event.target.value.trim(),
                        });
                      }}
                    />
                  }
                />

                <SettingCardRow
                  className="model-page__setting-card-row--block"
                  title={t("model_page.fields.api_key.title")}
                  description={t("model_page.fields.api_key.description")}
                  action={
                    <Textarea
                      className="model-page__textarea"
                      value={model.api_key}
                      disabled={props.readonly}
                      placeholder={t("model_page.fields.api_key.placeholder")}
                      onChange={(event) => {
                        void props.onPatch({
                          api_key: event.target.value,
                        });
                      }}
                    />
                  }
                />

                <SettingCardRow
                  className="model-page__setting-card-row--auto-action"
                  title={t("model_page.fields.model_id.title")}
                  description={t("model_page.fields.model_id.description").replace(
                    "{MODEL}",
                    model.model_id,
                  )}
                  action={
                    <div className="model-page__inline-button-group">
                      <AppButton
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={props.readonly}
                        onClick={() => {
                          set_model_id_input_value(model.model_id);
                          set_is_model_id_editor_open(true);
                        }}
                      >
                        <PencilLine data-icon="inline-start" />
                        {t("model_page.action.input")}
                      </AppButton>
                      <AppButton
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={props.readonly}
                        onClick={props.onRequestOpenSelector}
                      >
                        <RefreshCw data-icon="inline-start" />
                        {t("model_page.action.fetch")}
                      </AppButton>
                      <AppButton
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={props.readonly}
                        onClick={() => {
                          void props.onRequestTestModel();
                        }}
                      >
                        <Send data-icon="inline-start" />
                        {t("model_page.action.test")}
                      </AppButton>
                    </div>
                  }
                />
              </>
            ) : null}

            {show_thinking_field ? (
              <SettingCardRow
                title={t("model_page.fields.thinking.title")}
                title_suffix={
                  <SettingHelpButton
                    url={THINKING_SUPPORT_URL_BY_LOCALE[locale]}
                    aria_label={t("model_page.fields.thinking.help_label")}
                  />
                }
                description={t("model_page.fields.thinking.description")}
                action={
                  <Select
                    value={model.thinking.level}
                    disabled={props.readonly}
                    onValueChange={(next_value) => {
                      if (
                        next_value === "OFF" ||
                        next_value === "LOW" ||
                        next_value === "MEDIUM" ||
                        next_value === "HIGH"
                      ) {
                        void props.onPatch({
                          thinking: {
                            level: next_value,
                          },
                        });
                      }
                    }}
                  >
                    <SelectTrigger className="model-page__field">
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
                }
              />
            ) : null}
          </div>
        </div>
      </AppPageDialog>

      <AppPageDialog
        open={is_model_id_editor_open}
        title={t("model_page.fields.model_id.title")}
        size="sm"
        onClose={() => {
          set_is_model_id_editor_open(false);
        }}
        footer={
          <>
            <AppButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                set_is_model_id_editor_open(false);
              }}
            >
              {t("app.action.cancel")}
            </AppButton>
            <AppButton
              type="button"
              size="sm"
              disabled={props.readonly}
              onClick={() => {
                void commit_model_id_input();
              }}
            >
              {t("model_page.dialog.model_id_input.confirm")}
            </AppButton>
          </>
        }
      >
        <Input
          autoFocus
          className="model-page__field model-page__field--full"
          value={model_id_input_value}
          disabled={props.readonly}
          placeholder={t("model_page.fields.model_id.placeholder")}
          onChange={(event) => {
            set_model_id_input_value(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit_model_id_input();
            }
          }}
        />
      </AppPageDialog>
    </>
  );
}

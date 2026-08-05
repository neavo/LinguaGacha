import { PencilLine, RefreshCw, Send } from "lucide-react";
import { useEffect, useState } from "react";

import { MODEL_THINKING_LEVELS, Model } from "@domain/model";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { MODEL_THINKING_LEVEL_LABEL_KEY } from "@frontend/features/model-selection/model-selection-meta";
import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { AppButton } from "@frontend/widgets/app-button";
import { Input } from "@frontend/shadcn/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frontend/shadcn/select";
import { Textarea } from "@frontend/shadcn/textarea";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { SettingHelpButton } from "@frontend/widgets/setting-help-button";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

type ModelBasicSettingsDialogProps = {
  open: boolean;
  model: ModelEntrySnapshot | null;
  readonly: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onRequestOpenSelector: () => void;
  onRequestTestModel: () => void;
  onClose: () => void;
};

// 支持说明只有中英文版本，未单独维护的 locale 统一落到英文页面。
const THINKING_SUPPORT_URL_BY_LOCALE = {
  "zh-CN": "https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupport",
  "en-US": "https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupportEN",
  "de-DE": "https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupportEN",
} as const;

/** 编辑模型名称、连接信息和思考档位的基础设置对话框。 */
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

  if (props.model === null) {
    return null;
  }

  const model = props.model;
  const show_thinking_field = Model.api_format_supports_thinking_configuration(model.api_format);

  /** 项目可能在输入弹窗保持打开时进入锁定态，提交点必须再次守卫。 */
  async function commit_model_id_input(): Promise<void> {
    if (props.readonly) {
      return;
    }

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
                  readOnly={props.readonly}
                  placeholder={t("model_page.fields.name.placeholder")}
                  onChange={(event) => {
                    void props.onPatch({
                      name: event.target.value.trim(),
                    });
                  }}
                />
              }
            />

            <SettingCardRow
              title={t("model_page.fields.api_url.title")}
              description={t("model_page.fields.api_url.description")}
              action={
                <Input
                  className="model-page__field model-page__field--lg"
                  value={model.api_url}
                  readOnly={props.readonly}
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
                  readOnly={props.readonly}
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

            {show_thinking_field ? (
              <SettingCardRow
                title={t("model_page.fields.thinking.title")}
                title_suffix={
                  <SettingHelpButton
                    url={THINKING_SUPPORT_URL_BY_LOCALE[locale]}
                    aria_label={t("model_page.fields.thinking.title")}
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
                        {MODEL_THINKING_LEVELS.map((thinking_level) => (
                          <SelectItem key={thinking_level} value={thinking_level}>
                            {t(MODEL_THINKING_LEVEL_LABEL_KEY[thinking_level])}
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
          readOnly={props.readonly}
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

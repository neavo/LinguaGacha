import { PencilLine, RefreshCw, Send } from "lucide-react";
import { Fragment, type JSX, useEffect, useState } from "react";

import { MODEL_SPEED_LEVELS, is_model_speed_level, is_model_thinking_level } from "@domain/model";
import { build_model_request_url } from "@domain/model-endpoint";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  MODEL_THINKING_LEVEL_LABEL_KEY,
  order_model_thinking_levels,
} from "@frontend/features/model-selection/model-selection-meta";
import { ModelSelectorDialog } from "@frontend/pages/model-page/dialogs/model-selector-dialog";
import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { AppButton } from "@frontend/widgets/app-button";
import { Input } from "@frontend/shadcn/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@frontend/shadcn/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { Textarea } from "@frontend/shadcn/textarea";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

type ModelBasicSettingsDialogProps = {
  open: boolean;
  model: ModelEntrySnapshot | null;
  readonly: boolean;
  test_disabled: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
  onRequestTestModel: () => void;
  onClose: () => void;
};

/** 显示文案与协议参数分别由界面和请求层拥有。 */
const SPEED_LABEL_KEYS = {
  STANDARD: "model_page.fields.speed.standard",
  FAST: "model_page.fields.speed.fast",
  ULTRAFAST: "model_page.fields.speed.ultrafast",
  DEFAULT: "model_page.fields.speed.default",
} as const;

/** 编辑模型名称、连接信息、思考与速度等级。 */
export function ModelBasicSettingsDialog(props: ModelBasicSettingsDialogProps): JSX.Element | null {
  const { t } = useI18n();
  // 手动输入与目录选择共用一个编辑入口，一次只打开一个。
  const [model_id_editor, set_model_id_editor] = useState<null | "input" | "selector">(null);
  const [model_id_input_value, set_model_id_input_value] = useState("");
  const [is_model_id_submitting, set_is_model_id_submitting] = useState(false); // 两个编辑入口共用的提交互斥

  useEffect(() => {
    if (!props.open) {
      set_model_id_editor(null);
    }
  }, [props.open]);

  if (props.model === null) {
    return null;
  }

  const model = props.model;
  const request_url = build_model_request_url(model.api_url, model.api_format, model.model_id);
  const thinking_label = t(MODEL_THINKING_LEVEL_LABEL_KEY[model.thinking.level]);

  /**
   * 项目可能在编辑窗口保持打开时进入锁定态，提交点必须再次守卫。
   * 只有保存成功才结束编辑，失败时保留草稿，错误通知由保存入口负责。
   */
  async function commit_model_id(next_model_id: string): Promise<void> {
    if (props.readonly || is_model_id_submitting) {
      return;
    }

    set_is_model_id_submitting(true);
    try {
      if (await props.onPatch({ model_id: next_model_id })) {
        set_model_id_editor(null);
      }
    } finally {
      set_is_model_id_submitting(false);
    }
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
              variant="group"
              action_width="content"
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

            {model.auth_type !== "oauth" ? (
              <>
                <SettingCardRow
                  variant="group"
                  action_width="content"
                  title={t("model_page.fields.api_url.title")}
                  description={
                    <>
                      {t("model_page.fields.api_url.description")}
                      <Tooltip>
                        <TooltipTrigger
                          render={<span tabIndex={0} className="model-page__request-url" />}
                        >
                          {request_url}
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="break-all">
                          {request_url}
                        </TooltipContent>
                      </Tooltip>
                    </>
                  }
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
                  variant="group"
                  className="model-page__setting-card-row--block"
                  title={t("model_page.fields.api_key.title")}
                  description={t("model_page.fields.api_key.description")}
                  action={
                    <Textarea
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
              </>
            ) : null}

            <SettingCardRow
              variant="group"
              action_width="content"
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
                      // 输入器每次打开时取当前值，后台快照不会覆盖本次输入。
                      set_model_id_input_value(model.model_id);
                      set_model_id_editor("input");
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
                    onClick={() => {
                      set_model_id_editor("selector");
                    }}
                  >
                    <RefreshCw data-icon="inline-start" />
                    {t("model_page.action.fetch")}
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={props.test_disabled}
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

            <SettingCardRow
              variant="group"
              action_width="content"
              title={t("model_page.fields.thinking.title")}
              description={t("model_page.fields.thinking.description")}
              action={
                <Select
                  value={model.thinking.level}
                  disabled={props.readonly}
                  onValueChange={(next_value) => {
                    if (is_model_thinking_level(next_value)) {
                      void props.onPatch({
                        thinking: {
                          level: next_value,
                        },
                      });
                    }
                  }}
                >
                  <SelectTrigger className="model-page__field">
                    <SelectValue>{thinking_label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {order_model_thinking_levels(model.available_thinking_levels).map(
                        (level, index) => {
                          const item = (
                            <SelectItem value={level}>
                              {t(MODEL_THINKING_LEVEL_LABEL_KEY[level])}
                            </SelectItem>
                          );
                          return (
                            <Fragment key={level}>
                              {level === "DEFAULT" && index > 0 ? <SelectSeparator /> : null}
                              {level === "DEFAULT" ? (
                                <Tooltip>
                                  <TooltipTrigger render={item} />
                                  <TooltipContent side="right">
                                    {t("app.model.thinking_level.default_description")}
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                item
                              )}
                            </Fragment>
                          );
                        },
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              }
            />
            {model.api_format === "OpenAIResponses" ? (
              <SettingCardRow
                variant="group"
                action_width="content"
                title={t("model_page.fields.speed.title")}
                description={t("model_page.fields.speed.description")}
                action={
                  <Select
                    value={model.request.speed_level}
                    disabled={props.readonly}
                    onValueChange={(value) => {
                      if (is_model_speed_level(value))
                        void props.onPatch({ request: { speed_level: value } });
                    }}
                  >
                    <SelectTrigger className="model-page__field">
                      <SelectValue>{t(SPEED_LABEL_KEYS[model.request.speed_level])}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {MODEL_SPEED_LEVELS.map((level) => {
                          const item = (
                            <SelectItem value={level}>{t(SPEED_LABEL_KEYS[level])}</SelectItem>
                          );
                          return (
                            <Fragment key={level}>
                              {level === "DEFAULT" ? <SelectSeparator /> : null}
                              {level === "DEFAULT" ? (
                                <Tooltip>
                                  <TooltipTrigger render={item} />
                                  <TooltipContent side="right">
                                    {t("model_page.fields.speed.default_description")}
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                item
                              )}
                            </Fragment>
                          );
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
              />
            ) : null}
          </div>
        </div>
      </AppPageDialog>

      {model_id_editor === "selector" ? (
        <ModelSelectorDialog
          model={model}
          readonly={props.readonly}
          submitting={is_model_id_submitting}
          onConfirm={(next_model_id) => {
            void commit_model_id(next_model_id);
          }}
          onClose={() => {
            set_model_id_editor(null);
          }}
        />
      ) : null}

      <AppPageDialog
        open={model_id_editor === "input"}
        title={t("model_page.fields.model_id.title")}
        size="sm"
        submitting={is_model_id_submitting}
        onClose={() => {
          set_model_id_editor(null);
        }}
        primaryAction={{
          label: t("app.action.confirm"),
          shortcut: "submit",
          disabled: props.readonly,
          onSelect: () => commit_model_id(model_id_input_value.trim()),
        }}
      >
        <Input
          autoFocus
          className="model-page__field model-page__field--full"
          value={model_id_input_value}
          readOnly={props.readonly || is_model_id_submitting}
          placeholder={t("model_page.fields.model_id.placeholder")}
          onChange={(event) => {
            set_model_id_input_value(event.target.value);
          }}
        />
      </AppPageDialog>
    </>
  );
}

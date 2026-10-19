import { LoaderCircle } from "lucide-react";
import { type JSX, useEffect, useMemo, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useDebouncedValue } from "@frontend/widgets/interactions/use-debounce";
import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import type { AvailableModel, ModelListResult } from "@shared/model-catalog";
import { Input } from "@frontend/shadcn/input";
import { AppButton } from "@frontend/widgets/app-button";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";

type ModelSelectorDialogProps = {
  model: ModelEntrySnapshot;
  readonly: boolean;
  submitting: boolean;
  onConfirm: (model_id: string) => void;
  onClose: () => void;
};

/**
 * 只在一次编辑期间挂载：目录、筛选和临时选择随卸载释放，点击列表只改选择，确认才交给调用方保存。
 */
export function ModelSelectorDialog(props: ModelSelectorDialogProps): JSX.Element {
  const { t } = useI18n();
  const config_id = props.model.id; // 配置条目 ID，查询目录时使用，区别于待编辑的 `model_id`
  const [available_models, set_available_models] = useState<AvailableModel[]>([]);
  const [is_loading, set_is_loading] = useState(true);
  const [filter_text, set_filter_text] = useState("");
  // 打开时取当前模型 ID，后台快照刷新不覆盖本次选择；不在目录中时视为未选。
  const [selected_id, set_selected_id] = useState(props.model.model_id);
  const debounced_filter_text = useDebouncedValue(filter_text); // 模型列表只做本地过滤，计算结果统一延迟刷新

  useEffect(() => {
    let active = true; // 切换目标或关闭后，迟到的结果和失败通知都要丢弃
    api_fetch<ModelListResult>("/api/models/list-available", { model_id: config_id })
      .then((payload) => {
        if (active) set_available_models(Array.isArray(payload.models) ? payload.models : []);
      })
      .catch((error: unknown) => {
        if (active) push_error_toast(t("app.feedback.read_failed"), error);
      })
      .finally(() => {
        if (active) set_is_loading(false);
      });
    return () => {
      active = false;
    };
  }, [config_id, t]);

  const filtered_models = useMemo(() => {
    const keyword = debounced_filter_text.trim().toLowerCase();
    if (keyword === "") {
      return available_models;
    } else {
      return available_models.filter((model) => model.id.toLowerCase().includes(keyword));
    }
  }, [available_models, debounced_filter_text]);

  // 有效选择以完整目录为准，搜索结果只决定显示范围。
  const has_selection = available_models.some((model) => model.id === selected_id);
  const locked = props.readonly || props.submitting; // 只读或提交期间冻结选择与确认

  return (
    <AppPageDialog
      open
      title={t("model_page.fields.model_id.title")}
      size="md"
      onClose={props.onClose}
      dismissBehavior={props.submitting ? "blocked" : "default"}
      bodyClassName="overflow-hidden p-0"
      footer={
        <>
          <AppButton
            type="button"
            variant="outline"
            size="sm"
            disabled={props.submitting}
            onClick={props.onClose}
          >
            {t("app.action.cancel")}
          </AppButton>
          <AppButton
            type="button"
            size="sm"
            disabled={!has_selection || locked}
            aria-busy={props.submitting || undefined}
            onClick={() => {
              props.onConfirm(selected_id);
            }}
          >
            {props.submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            {t("app.action.confirm")}
          </AppButton>
        </>
      }
    >
      <div className="model-page__dialog-scroll">
        <div className="model-page__selector-body">
          <Input
            className="model-page__field model-page__field--full"
            value={filter_text}
            placeholder={t("model_page.dialog.selector.search_placeholder")}
            onChange={(event) => {
              set_filter_text(event.target.value);
            }}
          />

          <div className="model-page__selector-list">
            {is_loading ? (
              <div className="model-page__selector-loading">
                <LoaderCircle className="animate-spin" />
                <span>{t("model_page.dialog.selector.loading")}</span>
              </div>
            ) : filtered_models.length === 0 ? (
              <div className="model-page__selector-empty" role="status">
                {t("model_page.dialog.selector.empty")}
              </div>
            ) : (
              <div className="model-page__selector-options">
                {filtered_models.map((model) => (
                  <AppButton
                    key={model.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="model-page__selector-item"
                    data-selected={model.id === selected_id ? "true" : undefined}
                    aria-pressed={model.id === selected_id}
                    disabled={locked}
                    onClick={() => {
                      set_selected_id(model.id);
                    }}
                  >
                    {model.id}
                  </AppButton>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppPageDialog>
  );
}

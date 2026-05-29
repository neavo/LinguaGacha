import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { useDebouncedValue } from "@frontend/widgets/interactions/use-debounce";
import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { Input } from "@frontend/shadcn/input";
import { ScrollArea } from "@frontend/shadcn/scroll-area";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";

type ModelSelectorDialogProps = {
  open: boolean;
  model: ModelEntrySnapshot | null;
  available_models: string[];
  filter_text: string;
  is_loading: boolean;
  onFilterTextChange: (next_text: string) => void;
  onLoadAvailableModels: (model_id: string) => Promise<void>;
  onSelectModelId: (model_name: string) => Promise<void>;
  onClose: () => void;
};
export function ModelSelectorDialog(props: ModelSelectorDialogProps): JSX.Element | null {
  const { t } = useI18n();
  const requested_model_id_ref = useRef<string | null>(null);
  const {
    available_models,
    filter_text,
    is_loading,
    model,
    onClose,
    onFilterTextChange,
    onLoadAvailableModels,
    onSelectModelId,
    open,
  } = props;
  const debounced_filter_text = useDebouncedValue(filter_text); // 模型列表只做本地过滤，派生结果统一延迟刷新

  useEffect(() => {
    if (!open || model === null) {
      requested_model_id_ref.current = null;
      return;
    }

    if (requested_model_id_ref.current === model.id) {
      return;
    }

    requested_model_id_ref.current = model.id;
    void onLoadAvailableModels(model.id);
  }, [model, onLoadAvailableModels, open]);

  const filtered_models = useMemo(() => {
    const keyword = debounced_filter_text.trim().toLowerCase();
    if (keyword === "") {
      return available_models;
    } else {
      return available_models.filter((model_name) => model_name.toLowerCase().includes(keyword));
    }
  }, [available_models, debounced_filter_text]);

  if (model === null) {
    return null;
  }

  return (
    <AppPageDialog
      open={open}
      title={t("model_page.fields.model_id.title")}
      size="md"
      onClose={onClose}
      bodyClassName="overflow-hidden p-0"
    >
      <div className="model-page__dialog-scroll">
        <div className="model-page__selector-body">
          <Input
            className="model-page__field model-page__field--full"
            value={filter_text}
            placeholder={t("model_page.dialog.selector.search_placeholder")}
            onChange={(event) => {
              onFilterTextChange(event.target.value);
            }}
          />

          <ScrollArea className="model-page__selector-list">
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
                {filtered_models.map((model_name) => (
                  <button
                    key={model_name}
                    type="button"
                    className="model-page__selector-item"
                    onClick={() => {
                      void onSelectModelId(model_name);
                    }}
                  >
                    {model_name}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </AppPageDialog>
  );
}

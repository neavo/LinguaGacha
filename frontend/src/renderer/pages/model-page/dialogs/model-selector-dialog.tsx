import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { useI18n } from "@/i18n";
import type { ModelEntrySnapshot } from "@/pages/model-page/types";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shadcn/empty";
import { Input } from "@/shadcn/input";
import { ScrollArea } from "@/shadcn/scroll-area";
import { AppPageDialog } from "@/widgets/app-page-dialog/app-page-dialog";

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

export function ModelSelectorDialog(
  props: ModelSelectorDialogProps,
): JSX.Element | null {
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
    const keyword = filter_text.trim().toLowerCase();
    if (keyword === "") {
      return available_models;
    } else {
      return available_models.filter((model_name) =>
        model_name.toLowerCase().includes(keyword),
      );
    }
  }, [available_models, filter_text]);

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
              <Empty variant="dashed" className="model-page__selector-empty">
                <EmptyHeader>
                  <EmptyTitle>
                    {t("model_page.dialog.selector.empty")}
                  </EmptyTitle>
                  <EmptyDescription>{model.model_id}</EmptyDescription>
                </EmptyHeader>
              </Empty>
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

import { useCallback, useEffect, useRef, useState } from "react";

import type { ModelUsage } from "@domain/model";
import { api_fetch, api_get } from "@frontend/app/desktop/desktop-api";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  normalize_model_selection_snapshot,
  type ModelSelectionOption,
  type ModelSelectionSnapshot,
} from "@shared/model-selection";

/** 页面内模型选择的公开状态与唯一写命令。 */
export type ModelSelectionController = {
  snapshot: ModelSelectionSnapshot;
  loading: boolean;
  updating: boolean;
  select_model: (usage: ModelUsage, model_id: string) => Promise<void>;
};

const EMPTY_SNAPSHOT = normalize_model_selection_snapshot({});

/** 页面生命周期内唯一拥有模型选择 query 与 command，不进入全局运行态。 */
export function useModelSelection(): ModelSelectionController {
  const { push_toast } = useDesktopToast();
  const { t } = useI18n();
  const [snapshot, set_snapshot] = useState<ModelSelectionSnapshot>(EMPTY_SNAPSHOT);
  const [loading, set_loading] = useState(true);
  const [updating, set_updating] = useState(false);
  const updating_ref = useRef(false); // React 提交 updating 前也要阻止同一帧重复命令

  useEffect(() => {
    let mounted = true;
    void api_get<unknown>("/api/models/selection")
      .then((payload) => {
        if (!mounted) return;
        const next = normalize_model_selection_snapshot(payload);
        set_snapshot(next);
      })
      .catch((error: unknown) => {
        if (mounted) {
          push_toast(
            "error",
            resolve_visible_error_message(error, t, t("app.model.selection.load_failed")),
          );
        }
      })
      .finally(() => {
        if (mounted) set_loading(false);
      });
    return () => {
      mounted = false;
    };
  }, [push_toast, t]);

  const select_model = useCallback(
    async (usage: ModelUsage, model_id: string): Promise<void> => {
      if (updating_ref.current || snapshot.model_selection[usage] === model_id) {
        return;
      }
      updating_ref.current = true;
      set_updating(true);
      try {
        const payload = await api_fetch<unknown>("/api/models/select", { usage, model_id });
        const next = normalize_model_selection_snapshot(payload);
        set_snapshot(next);
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("app.model.selection.update_failed")),
        );
      } finally {
        updating_ref.current = false;
        set_updating(false);
      }
    },
    [push_toast, snapshot, t],
  );

  return { snapshot, loading, updating, select_model };
}

/** 从公开快照读取用途对应模型，失效选择不伪造回退项。 */
export function read_selected_model(
  controller: ModelSelectionController,
  usage: ModelUsage,
): ModelSelectionOption | null {
  const selected_id = controller.snapshot.model_selection[usage];
  return controller.snapshot.models.find((model) => model.id === selected_id) ?? null;
}

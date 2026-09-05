import { useCallback, useEffect, useRef, useState } from "react";

import type { ModelThinkingLevel, ModelUsage } from "@domain/model";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { api_fetch, api_get } from "@frontend/app/desktop/desktop-api";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  normalize_model_selection_snapshot,
  type ModelSelectionOption,
  type ModelSelectionSnapshot,
} from "@shared/model-selection";

/** 页面内模型选择及所选模型思考配置的公开状态与唯一写命令。 */
export type ModelSelectionController = {
  snapshot: ModelSelectionSnapshot;
  loading: boolean;
  updating: boolean;
  select_model: (usage: ModelUsage, model_id: string) => Promise<void>;
  update_thinking_level: (usage: ModelUsage, thinking_level: ModelThinkingLevel) => Promise<void>; // 后端按用途原子定位当前模型，调用方不提交可能过期的模型 ID
};

const EMPTY_SNAPSHOT = normalize_model_selection_snapshot({});

/** 页面生命周期内唯一拥有模型控制 query 与 command，不进入全局运行态。 */
export function useModelSelection(): ModelSelectionController {
  const { push_toast } = useDesktopToast();
  const { t } = useI18n();
  const runtime_idle = useRuntimeSnapshot().owner === null; // Agent 释放 lease 后刷新其保存的翻译选择
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
  }, [push_toast, t, runtime_idle]);

  /** 两种模型控制命令共用提交、回包归一和错误恢复。 */
  const update_snapshot = useCallback(
    async (path: string, request: Record<string, string>): Promise<void> => {
      if (updating_ref.current) return;
      updating_ref.current = true;
      set_updating(true);
      try {
        const payload = await api_fetch<unknown>(path, request);
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
    [push_toast, t],
  );

  const select_model = useCallback(
    async (usage: ModelUsage, model_id: string): Promise<void> => {
      if (snapshot.model_selection[usage] === model_id) return;
      await update_snapshot("/api/models/select", { usage, model_id });
    },
    [snapshot.model_selection, update_snapshot],
  );

  const update_thinking_level = useCallback(
    async (usage: ModelUsage, thinking_level: ModelThinkingLevel): Promise<void> => {
      const selected = snapshot.models.find(
        (model) => model.id === snapshot.model_selection[usage],
      );
      if (selected === undefined || selected.thinking_level === thinking_level) {
        return;
      }
      await update_snapshot("/api/models/thinking-level/update", { usage, thinking_level });
    },
    [snapshot, update_snapshot],
  );

  return { snapshot, loading, updating, select_model, update_thinking_level };
}

/** 从公开快照读取用途对应模型，失效选择不伪造回退项。 */
export function read_selected_model(
  controller: ModelSelectionController,
  usage: ModelUsage,
): ModelSelectionOption | null {
  const selected_id = controller.snapshot.model_selection[usage];
  return controller.snapshot.models.find((model) => model.id === selected_id) ?? null;
}

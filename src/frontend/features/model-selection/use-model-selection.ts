import { useCallback, useEffect, useRef, useState } from "react";

import type { ModelThinkingLevel, ModelUsage } from "@domain/model";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { api_fetch, api_get } from "@frontend/app/desktop/desktop-api";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  normalize_model_selection_snapshot,
  type ModelSelectionChange,
  type ModelSelectionOption,
  type ModelSelectionSnapshot,
} from "@shared/model-selection";

/** 页面内模型选择及所选模型思考配置的公开状态与唯一写命令。 */
export type ModelSelectionController = {
  snapshot: ModelSelectionSnapshot;
  loading: boolean;
  updating: boolean;
  select_model: (change: ModelSelectionChange) => Promise<void>;
  update_thinking_level: (usage: ModelUsage, thinking_level: ModelThinkingLevel) => Promise<void>; // 后端按用途原子定位当前模型，调用方不提交可能过期的模型 ID
};

const EMPTY_SNAPSHOT = normalize_model_selection_snapshot({});

/** 页面生命周期内唯一拥有模型控制 query 与 command，不进入全局运行态。 */
export function useModelSelection(): ModelSelectionController {
  const { push_toast } = useDesktopToast();
  const { t } = useI18n();
  const runtime_idle = useRuntimeSnapshot().owner === null; // 共享运行占用变化后刷新配置快照
  const [snapshot, set_snapshot] = useState<ModelSelectionSnapshot>(EMPTY_SNAPSHOT);
  const [loading, set_loading] = useState(true);
  const [updating, set_updating] = useState(false);
  const settings_revision_ref = useRef(0); // 保存设置使此前发出的查询失效
  const updating_ref = useRef(false); // React 提交 updating 前也要阻止同一帧重复命令

  useEffect(() => {
    if (updating_ref.current) return;
    let mounted = true;
    const settings_revision = settings_revision_ref.current;
    void api_get<unknown>("/api/models/selection")
      .then((payload) => {
        if (!mounted || settings_revision !== settings_revision_ref.current) return;
        const next = normalize_model_selection_snapshot(payload);
        set_snapshot(next);
      })
      .catch((error: unknown) => {
        if (mounted && settings_revision === settings_revision_ref.current) {
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

  /** 模型控制命令共用提交、回包归一和错误恢复。 */
  const update_snapshot = useCallback(
    async (path: string, request: Record<string, string | null>): Promise<void> => {
      if (updating_ref.current) return;
      updating_ref.current = true;
      settings_revision_ref.current += 1;
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

  /** 同时比较选择和全局等级，允许当前模型换档及其它模型沿用已选档位。 */
  const select_model = useCallback(
    async (change: ModelSelectionChange): Promise<void> => {
      const level = "thinking_level" in change ? change.thinking_level : undefined;
      const model = snapshot.models.find((item) => item.id === change.model_id);
      if (
        snapshot.model_selection[change.target] === change.model_id &&
        (level === undefined || model?.thinking_level === level)
      )
        return;
      await update_snapshot("/api/models/select", change);
    },
    [snapshot, update_snapshot],
  );

  /** 独立档位入口按用途更新当前模型，重复档位无需保存。 */
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

  return {
    snapshot,
    loading,
    updating,
    select_model,
    update_thinking_level,
  };
}

/** 从公开快照读取用途对应模型，失效选择不伪造回退项。 */
export function read_selected_model(
  controller: ModelSelectionController,
  usage: ModelUsage,
): ModelSelectionOption | null {
  const selected_id = controller.snapshot.model_selection[usage];
  return controller.snapshot.models.find((model) => model.id === selected_id) ?? null;
}

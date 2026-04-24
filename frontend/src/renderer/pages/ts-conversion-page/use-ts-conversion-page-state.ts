import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { api_fetch } from "@/app/desktop-api";
import { useDesktopRuntime } from "@/app/state/use-desktop-runtime";
import { useDesktopToast } from "@/app/state/use-desktop-toast";
import { useI18n } from "@/i18n";
import {
  build_ts_conversion_converted_items,
  build_ts_conversion_custom_rules,
  collect_ts_conversion_text_types,
  normalize_ts_conversion_runtime_items,
} from "@/pages/ts-conversion-page/logic";
import type {
  TsConversionDirection,
  TsConversionExportPayload,
  TsConversionPresetRulesPayload,
} from "@/pages/ts-conversion-page/types";

type TsConversionConfirmState = {
  open: boolean;
  submitting: boolean;
};

function create_empty_confirm_state(): TsConversionConfirmState {
  return {
    open: false,
    submitting: false,
  };
}

function resolve_suffix(direction: TsConversionDirection): string {
  return direction === "s2t" ? "_S2T" : "_T2S";
}

export function useTsConversionPageState() {
  const { t } = useI18n();
  const { project_snapshot, project_store } = useDesktopRuntime();
  const { push_toast, push_progress_toast, update_progress_toast, dismiss_toast } =
    useDesktopToast();
  const project_store_state = useSyncExternalStore(
    project_store.subscribe,
    project_store.getState,
    project_store.getState,
  );
  const [direction, set_direction] = useState<TsConversionDirection>("s2t");
  const [preserve_text, set_preserve_text] = useState(true);
  const [convert_name, set_convert_name] = useState(true);
  const [confirm_state, set_confirm_state] = useState<TsConversionConfirmState>(() =>
    create_empty_confirm_state(),
  );
  const [is_running, set_is_running] = useState(false);
  const run_active_ref = useRef(false);

  const runtime_items = useMemo(() => {
    return normalize_ts_conversion_runtime_items(project_store_state.items);
  }, [project_store_state.items]);

  const request_conversion = useCallback((): void => {
    if (run_active_ref.current) {
      push_toast("warning", t("ts_conversion_page.feedback.task_running"));
      return;
    }
    if (!project_snapshot.loaded) {
      push_toast("error", t("ts_conversion_page.feedback.project_required"));
      return;
    }
    if (runtime_items.length === 0) {
      push_toast("warning", t("ts_conversion_page.feedback.no_data"));
      return;
    }

    set_confirm_state({
      open: true,
      submitting: false,
    });
  }, [project_snapshot.loaded, push_toast, runtime_items.length, t]);

  const close_confirm_dialog = useCallback((): void => {
    set_confirm_state((previous_state) => {
      return previous_state.submitting ? previous_state : create_empty_confirm_state();
    });
  }, []);

  const confirm_conversion = useCallback(async (): Promise<void> => {
    if (run_active_ref.current) {
      return;
    }

    run_active_ref.current = true;
    set_is_running(true);
    set_confirm_state({
      open: false,
      submitting: false,
    });
    const progress_toast_id = push_progress_toast({
      message: t("ts_conversion_page.action.preparing"),
      presentation: "modal",
    });

    try {
      const text_preserve_slice = project_store.getState().quality.text_preserve;
      const text_preserve_mode = String(text_preserve_slice.mode ?? "off");
      const normalized_text_preserve_mode = text_preserve_mode.toLowerCase();
      const custom_rules = build_ts_conversion_custom_rules(text_preserve_slice.entries);
      const preset_rules_by_text_type =
        preserve_text &&
        normalized_text_preserve_mode !== "off" &&
        normalized_text_preserve_mode !== "custom"
          ? ((
              await api_fetch<TsConversionPresetRulesPayload>(
                "/api/project/text-preserve/preset-rules",
                {
                  text_types: collect_ts_conversion_text_types(runtime_items),
                },
              )
            ).rules ?? {})
          : {};

      update_progress_toast(progress_toast_id, {
        message: t("ts_conversion_page.action.progress")
          .replace("{CURRENT}", runtime_items.length === 0 ? "0" : "1")
          .replace("{TOTAL}", runtime_items.length.toString()),
        presentation: "modal",
      });
      await Promise.resolve();

      const converted_items = build_ts_conversion_converted_items({
        items: runtime_items,
        direction,
        convert_name,
        preserve_text,
        text_preserve_mode,
        custom_rules,
        preset_rules_by_text_type,
      });

      update_progress_toast(progress_toast_id, {
        message: t("ts_conversion_page.action.progress")
          .replace("{CURRENT}", runtime_items.length.toString())
          .replace("{TOTAL}", runtime_items.length.toString()),
        presentation: "modal",
      });

      await api_fetch<TsConversionExportPayload>("/api/project/export-converted-translation", {
        suffix: resolve_suffix(direction),
        items: converted_items,
      });
      dismiss_toast(progress_toast_id);
      push_toast("success", t("ts_conversion_page.feedback.task_success"));
    } catch (error) {
      dismiss_toast(progress_toast_id);
      if (error instanceof Error && error.message.trim() !== "") {
        push_toast("error", error.message);
      } else {
        push_toast("error", t("ts_conversion_page.feedback.task_failed"));
      }
    } finally {
      run_active_ref.current = false;
      set_is_running(false);
    }
  }, [
    convert_name,
    direction,
    dismiss_toast,
    preserve_text,
    project_store,
    push_progress_toast,
    push_toast,
    runtime_items,
    t,
    update_progress_toast,
  ]);

  return {
    direction,
    preserve_text,
    convert_name,
    confirm_state,
    is_running,
    set_direction,
    set_preserve_text,
    set_convert_name,
    request_conversion,
    confirm_conversion,
    close_confirm_dialog,
  };
}

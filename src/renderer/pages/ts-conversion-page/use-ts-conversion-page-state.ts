import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { api_fetch } from "@/app/desktop/desktop-api";
import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";
import { useDesktopToast } from "@/app/ui-runtime/toast/use-desktop-toast";
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
  TsConversionRulePresetPayload,
} from "@/pages/ts-conversion-page/types";
import { ITEM_TEXT_TYPES } from "@base/item";

type TsConversionConfirmState = {
  open: boolean;
};

const TS_CONVERSION_PRESET_TEXT_TYPES = new Set<string>(ITEM_TEXT_TYPES);

// 确认弹窗状态保持独立构造，避免关闭和初始化分支各自拼对象。
function create_empty_confirm_state(): TsConversionConfirmState {
  return {
    open: false,
  };
}

// 导出后缀沿用 旧写出链路的既有命名约定，页面只按方向选择。
function resolve_suffix(direction: TsConversionDirection): string {
  return direction === "s2t" ? "_S2T" : "_T2S";
}

// 质量规则预设返回原始 entries，简繁转换页只消费非空 src 作为保护规则。
function extract_preset_rule_sources(entries: unknown[] | undefined): string[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const src = (entry as Record<string, unknown>).src;
    return typeof src === "string" && src.trim() !== "" ? [src.trim()] : [];
  });
}

// 单个 text_type 读取失败不应中断整次转换，缺失预设等价于没有保护规则。
async function read_preset_rules_for_text_type(text_type: string): Promise<string[]> {
  try {
    const payload = await api_fetch<TsConversionRulePresetPayload>(
      "/api/quality/rules/presets/read",
      {
        rule_type: "text_preserve",
        virtual_id: `builtin:${text_type.toLowerCase()}.json`,
      },
    );
    return extract_preset_rule_sources(payload.entries);
  } catch {
    // 内置保护规则不是每个 text_type 都齐全，读取失败时按空规则继续导出。
    return [];
  }
}

// 按原始 text_type 大写键回填规则，保持转换逻辑与运行态条目字段一致。
async function read_preset_rules_by_text_type(
  text_types: string[],
): Promise<Record<string, string[]>> {
  // 未知 text_type 沿用旧路由语义跳过，避免把脏数据映射成其它预设。
  const known_text_types = text_types.filter((text_type) =>
    TS_CONVERSION_PRESET_TEXT_TYPES.has(text_type),
  );
  const entries = await Promise.all(
    known_text_types.map(async (text_type) => {
      return [text_type, await read_preset_rules_for_text_type(text_type)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

// 页面状态只编排确认、进度和导出请求；实际转换规则留在纯逻辑模块。
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
  // 用 ref 阻止同一轮异步转换被重复触发，避免重复写出文件。
  const run_active_ref = useRef(false);

  // runtime_items 从 ProjectStore 派生，确认弹窗打开后仍以当前 store 快照执行转换。
  const runtime_items = useMemo(() => {
    return normalize_ts_conversion_runtime_items(project_store_state.items);
  }, [project_store_state.items]);

  // 请求阶段只做可执行性校验，不提前读取预设或生成转换结果。
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
    });
  }, [project_snapshot.loaded, push_toast, runtime_items.length, t]);

  const close_confirm_dialog = useCallback((): void => {
    set_confirm_state(create_empty_confirm_state());
  }, []);

  // 确认后串行完成预设读取、文本转换和文件导出，保证进度提示生命周期完整。
  const confirm_conversion = useCallback(async (): Promise<void> => {
    if (run_active_ref.current) {
      return;
    }

    run_active_ref.current = true;
    set_is_running(true);
    set_confirm_state({
      open: false,
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
      // 非 custom 模式才读取内置预设；custom 模式完全使用项目中的页面规则。
      const preset_rules_by_text_type =
        preserve_text &&
        normalized_text_preserve_mode !== "off" &&
        normalized_text_preserve_mode !== "custom"
          ? await read_preset_rules_by_text_type(collect_ts_conversion_text_types(runtime_items))
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

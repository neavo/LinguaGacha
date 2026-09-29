import { useQualityRuleTable } from "@frontend/features/quality-rule-editor/use-quality-rule-table";
import { useQualityRuleEditing } from "@frontend/features/quality-rule-editor/use-quality-rule-editing";
import { useQualityRulePresets } from "@frontend/features/quality-rule-editor/use-quality-rule-presets";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppNavigation } from "@frontend/app/navigation/navigation-context";

import { buildProofreadingLookupQuery } from "@shared/quality/quality-rule-proofreading-query";
import type { QualityRuleSlice } from "@shared/quality/quality-rule-state";
import { useQualityRuleQuery } from "@frontend/features/quality-rule-editor/use-quality-rule-query";
import {
  isQualityRuleStatisticsCacheReady,
  isQualityRuleStatisticsCacheRunning,
  type QualityRuleStatisticsCacheSnapshot,
} from "@frontend/app/session/quality-rule-statistics-store";

import { useQualityRuleStatistics } from "@frontend/app/session/quality-rule-statistics-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import {
  ModalProgressToastTimeoutError,
  push_toast,
  run_modal_progress_toast,
} from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";

import {
  build_text_preserve_filter_result,
  sort_text_preserve_entries,
} from "@frontend/pages/text-preserve-page/filtering";

import type {
  TextPreserveEntry,
  TextPreserveEntryDraft,
  TextPreserveEntryId,
  TextPreserveFilterState,
  TextPreserveMode,
  TextPreserveHitBadgeState,
  TextPreserveHitState,
} from "@frontend/pages/text-preserve-page/types";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";

import { build_text_preserve_rule } from "@shared/text/text-preserve-rules";

type TextPreserveQualitySlice = {
  mode: TextPreserveMode;
  entries: TextPreserveEntry[];
  section_revision: number;
};

// 后端质量规则 API 与统计缓存共用的规则类型。
const TEXT_PRESERVE_RULE_TYPE = "text_preserve";
const TEXT_PRESERVE_TITLE_KEY: LocaleKey = "text_preserve_page.title";
// 导出接口展示给系统保存框的默认文件名。
const TEXT_PRESERVE_EXPORT_FILE_NAME = "text_preserve.json";
// 查询完成前显示关闭模式。
const DEFAULT_MODE: TextPreserveMode = "off";
// 首次查询前使用与后端默认语义一致的只读切片。
const DEFAULT_QUALITY_SLICE: TextPreserveQualitySlice = {
  mode: DEFAULT_MODE,
  entries: [],
  section_revision: 0,
};
// 模式切换必须等项目事件回流，超时后由补偿刷新恢复权威快照。
const TEXT_PRESERVE_MODE_REFRESH_TIMEOUT_MS = 15000;
// session 恢复排序的白名单，避免旧列 ID 进入当前表格。
const TEXT_PRESERVE_SORT_COLUMN_IDS = new Set(["src", "info", "hit"]);

// 对话框总是克隆该模板，避免复用可变草稿引用。
const EMPTY_ENTRY: TextPreserveEntryDraft = {
  src: "",
  info: "",
};

/**
 * 在保存边界按文本保护字段白名单投影并裁掉文本两端空白，同时保留稳定条目 ID。
 */
function normalize_entry<Entry extends TextPreserveEntryDraft>(entry: Entry): Entry {
  return {
    entry_id: entry.entry_id,
    src: entry.src.trim(),
    info: entry.info.trim(),
  } as Entry;
}

/**
 * 将完整质量规则查询映射为页面状态。
 */
function normalize_text_preserve_quality_slice(
  slice: QualityRuleSlice<"text_preserve">,
  section_revision: number,
): TextPreserveQualitySlice {
  return {
    mode: slice.mode,
    entries: slice.entries,
    section_revision,
  };
}

/** 新项目或清空筛选时的完整筛选状态。 */
function create_empty_filter_state(): TextPreserveFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
  };
}

/** 把命中数投影为文本保护徽章说明。 */
function build_hit_badge_tooltip(t: (key: LocaleKey) => string, hits: number): string {
  return t("quality_rule_editor.hit.hit_count").replace("{COUNT}", hits.toString());
}

/**
 * 将会话级统计缓存投影为页面只读状态，不复制规则事实。
 */
function build_text_preserve_hit_state_from_cache(
  statistics_cache: QualityRuleStatisticsCacheSnapshot,
): TextPreserveHitState {
  // 页面只从质量统计缓存计算展示状态，不持有也不修改文本保护规则事实。
  return {
    running: isQualityRuleStatisticsCacheRunning(statistics_cache),
    entry_ids: statistics_cache.entry_ids,
    hits_by_entry_id: statistics_cache.hits_by_entry_id,
  };
}

/**
 * 聚合文本保护页面的项目快照、筛选状态、统计缓存与唯一写入口。
 *
 * 页面组件只消费该 Hook 暴露的快照和意图，避免绕过项目写锁直接修改后端状态。
 */
export function useTextPreservePageState() {
  const { t } = useI18n();

  const { navigate_to_route, push_proofreading_lookup_intent } = useAppNavigation();
  const { project_snapshot, project_session_status = "ready" } = useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();
  /** 将查询失败交给页面反馈入口。 */
  const handle_quality_rule_load_error = useCallback(
    (error: unknown): void => {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("text_preserve_page.feedback.load_failed")),
      );
    },
    [t],
  );
  const {
    quality_slice,
    quality_status,
    reload_quality_rule_snapshot,
    refresh_quality_rule_snapshot,
  } = useQualityRuleQuery({
    rule_type: TEXT_PRESERVE_RULE_TYPE,
    project_path:
      project_snapshot.loaded && project_session_status === "ready" ? project_snapshot.path : "",
    session_ready: project_session_status === "ready",
    default_slice: DEFAULT_QUALITY_SLICE,
    normalize_slice: normalize_text_preserve_quality_slice,
    on_load_error: handle_quality_rule_load_error,
  });
  const mode = project_snapshot.loaded ? quality_slice.mode : DEFAULT_MODE;
  const entries = project_snapshot.loaded ? quality_slice.entries : DEFAULT_QUALITY_SLICE.entries;
  const [mode_updating, set_mode_updating] = useState(false);

  const unknown_error_message = t("text_preserve_page.feedback.unknown_error");
  const mode_ref = useRef(mode);
  const mode_update_in_flight_ref = useRef(false);

  const statistics_cache = useQualityRuleStatistics(TEXT_PRESERVE_RULE_TYPE);
  const hit_state = useMemo<TextPreserveHitState>(() => {
    return build_text_preserve_hit_state_from_cache(statistics_cache);
  }, [statistics_cache]);
  const hit_ready = isQualityRuleStatisticsCacheReady(statistics_cache);
  const readonly = is_runtime_busy(runtime_snapshot);
  /** 组合本页筛选、排序和统计，交给公共表格维护结果。 */
  const build_table_result = useCallback(
    (filter_state: TextPreserveFilterState, sort_state: AppTableSortState | null) => {
      const result = build_text_preserve_filter_result({ entries, filter_state });
      return {
        ...result,
        visible_entries: sort_text_preserve_entries(
          result.visible_entries,
          sort_state,
          hit_ready,
          hit_state,
        ),
      };
    },
    [entries, hit_ready, hit_state],
  );
  const table = useQualityRuleTable({
    key: `quality:${TEXT_PRESERVE_RULE_TYPE}`,
    project_path:
      project_snapshot.loaded && project_session_status === "ready" ? project_snapshot.path : "",
    section_revision: quality_slice.section_revision,
    loaded: quality_status === "ready",
    readonly,
    entries,
    create_filter: create_empty_filter_state,
    sort_columns: TEXT_PRESERVE_SORT_COLUMN_IDS,
    reset_hit_sort: !hit_ready,
    build_result: build_table_result,
  });
  const { entry_ids, entry_index_by_id, reorder_disabled, set_pending_result_refresh } = table;

  useEffect(() => {
    mode_ref.current = mode;
  }, [mode]);

  const completed_hit_entry_id_set = useMemo<ReadonlySet<TextPreserveEntryId>>(() => {
    return new Set(hit_state.entry_ids ?? []);
  }, [hit_state.entry_ids]);

  const hit_badge_by_entry_id = useMemo<
    Record<TextPreserveEntryId, TextPreserveHitBadgeState>
  >(() => {
    const next_badge_by_entry_id: Record<TextPreserveEntryId, TextPreserveHitBadgeState> = {};
    if (!hit_ready && hit_state.entry_ids === null) {
      return next_badge_by_entry_id;
    }

    entry_ids.forEach((entry_id) => {
      if (!completed_hit_entry_id_set.has(entry_id)) {
        return;
      }

      const hits = hit_state.hits_by_entry_id[entry_id] ?? 0;
      next_badge_by_entry_id[entry_id] = {
        kind: hits > 0 ? "matched" : "unmatched",
        hits,
        tooltip: build_hit_badge_tooltip(t, hits),
      };
    });

    return next_badge_by_entry_id;
  }, [completed_hit_entry_id_set, entry_ids, hit_ready, hit_state, t]);

  /** 按统一错误契约解析文本保护操作失败。 */
  const push_action_error_toast = useCallback(
    (error: unknown): void => {
      push_toast("error", resolve_visible_error_message(error, t, unknown_error_message));
    },
    [t, unknown_error_message],
  );

  /** 串行切换保护模式，并等待质量快照刷新。 */

  /** 在提交前校验规则并反馈字段错误。 */
  const validate_entry = useCallback(
    (entry: TextPreserveEntryDraft): string | null => {
      if (entry.src === "") {
        return null;
      }

      try {
        build_text_preserve_rule({ mode: "custom", text_type: "NONE", entries: [entry] });
        return null;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        return `${t("quality_rule_editor.feedback.regex_invalid")}: ${detail}`;
      }
    },
    [t],
  );
  const presets = useQualityRulePresets(TEXT_PRESERVE_RULE_TYPE, entries.map(normalize_entry));
  const editing = useQualityRuleEditing({
    rule_type: TEXT_PRESERVE_RULE_TYPE,
    project_path:
      project_snapshot.loaded && project_session_status === "ready" ? project_snapshot.path : "",
    entries,
    section_revision: quality_slice.section_revision,
    readonly,
    reorder_disabled,
    empty_entry: EMPTY_ENTRY,
    normalize: normalize_entry,
    validate: validate_entry,
    selection: table.session,
    refresh: refresh_quality_rule_snapshot,
    set_result_refresh: set_pending_result_refresh,
    close_preset_menu: () => presets.set_preset_menu_open(false),
    export_file_name: TEXT_PRESERVE_EXPORT_FILE_NAME,
  });

  const { update_meta } = editing;
  /** 串行切换保护模式，并等待工程提交与快照刷新。 */
  const update_mode = useCallback(
    async (next_mode: TextPreserveMode): Promise<void> => {
      const previous_mode = mode_ref.current;
      if (readonly || mode_update_in_flight_ref.current || previous_mode === next_mode) {
        return;
      }

      mode_update_in_flight_ref.current = true;
      set_mode_updating(true);
      let snapshot_committed = false;

      try {
        await run_modal_progress_toast({
          message: t("text_preserve_page.mode.loading_toast"),
          timeout_ms: TEXT_PRESERVE_MODE_REFRESH_TIMEOUT_MS,
          task: async () => {
            await update_meta({ mode: next_mode });
            snapshot_committed = true;
          },
        });
      } catch (error) {
        if (snapshot_committed && error instanceof ModalProgressToastTimeoutError) {
          push_toast("warning", t("text_preserve_page.feedback.mode_refresh_pending"));
        } else {
          push_action_error_toast(error);
        }
      } finally {
        mode_update_in_flight_ref.current = false;
        set_mode_updating(false);
      }
    },
    [push_action_error_toast, update_meta, readonly, t],
  );
  /** 用所选规则发起校对页查找。 */
  const query_entry_source = useCallback(
    async (entry_id: TextPreserveEntryId): Promise<void> => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      try {
        push_proofreading_lookup_intent(
          buildProofreadingLookupQuery({
            rule_type: TEXT_PRESERVE_RULE_TYPE,
            entry: normalize_entry(target_entry),
          }),
        );
        navigate_to_route("proofreading");
      } catch (error) {
        push_action_error_toast(error);
      }
    },
    [
      entries,
      entry_index_by_id,
      navigate_to_route,
      push_proofreading_lookup_intent,
      push_action_error_toast,
    ],
  );

  return {
    editing,
    table,
    presets,
    quality_status,
    reload_quality_rule_snapshot,
    title_key: TEXT_PRESERVE_TITLE_KEY,
    mode,
    mode_updating,

    readonly,
    hit_state,
    hit_ready,
    hit_badge_by_entry_id,

    update_mode,
    query_entry_source,
  };
}

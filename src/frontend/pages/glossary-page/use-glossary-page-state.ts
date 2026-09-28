import { useQualityRuleTable } from "@frontend/features/quality-rule-editor/use-quality-rule-table";
import { useQualityRuleEditing } from "@frontend/features/quality-rule-editor/use-quality-rule-editing";
import { useQualityRulePresets } from "@frontend/features/quality-rule-editor/use-quality-rule-presets";
import { useCallback, useMemo } from "react";

import { useAppNavigation } from "@frontend/app/navigation/navigation-context";

import { buildProofreadingLookupQuery } from "@shared/quality/quality-rule-proofreading-query";
import { type QualityRuleQuerySlice } from "@frontend/features/quality-rule-editor/quality-rule-api-client";
import { useQualityRuleQuery } from "@frontend/features/quality-rule-editor/use-quality-rule-query";
import {
  isQualityRuleStatisticsCacheReady,
  isQualityRuleStatisticsCacheRunning,
  type QualityRuleStatisticsCacheSnapshot,
} from "@frontend/app/session/quality-rule-statistics-store";

import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useQualityRuleStatistics } from "@frontend/app/session/quality-rule-statistics-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";

import { resolve_quality_rule_hit_badge_kind } from "@frontend/features/quality-rule-editor/quality-rule-filtering";

import { build_glossary_filter_result } from "@frontend/pages/glossary-page/filtering";

import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";
import type {
  GlossaryEntry,
  GlossaryEntryDraft,
  GlossaryEntryId,
  GlossaryFilterState,
  GlossaryHitBadgeState,
  GlossaryHitState,
} from "@frontend/pages/glossary-page/types";

type GlossaryQualitySlice = {
  enabled: boolean;
  entries: GlossaryEntry[];
  section_revision: number;
};

// 元信息开关与条目保存使用不同诊断名，便于定位失败的写入意图。

// 对话框总是克隆该模板，避免复用可变草稿引用。
const EMPTY_ENTRY: GlossaryEntryDraft = {
  src: "",
  dst: "",
  info: "",
  case_sensitive: false,
};
// 首次查询前使用与后端默认语义一致的只读切片。
const DEFAULT_QUALITY_SLICE: GlossaryQualitySlice = {
  enabled: true,
  entries: [],
  section_revision: 0,
};
/** 新项目或清空筛选时的完整筛选状态。 */
function create_empty_filter_state(): GlossaryFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
  };
}

// session 恢复排序的白名单，防止旧版本或其它页面列 id 泄入本页。
const GLOSSARY_SORT_FIELDS = new Set(["src", "dst", "info", "rule", "hit"]);

/**
 * 在保存边界按术语字段白名单投影并裁掉文本两端空白，同时保留稳定条目 ID。
 */
function normalize_dialog_entry<Entry extends GlossaryEntryDraft>(entry: Entry): Entry {
  return {
    entry_id: entry.entry_id,
    src: entry.src.trim(),
    dst: entry.dst.trim(),
    info: entry.info.trim(),
    case_sensitive: entry.case_sensitive,
  } as Entry;
}

/**
 * 将后端 quality 查询收窄为页面稳定切片。
 */
function normalize_glossary_quality_slice(
  slice: QualityRuleQuerySlice<"glossary"> | undefined,
  section_revision: number,
): GlossaryQualitySlice {
  const raw_entries = Array.isArray(slice?.entries) ? slice.entries : [];
  return {
    enabled: slice?.enabled === undefined ? true : Boolean(slice.enabled),
    entries: raw_entries.map((entry) => normalize_dialog_entry(entry)),
    section_revision,
  };
}

/**
 * 将命中数和子集父项关系合并成徽章的多行说明。
 */
function build_hit_badge_tooltip(
  t: (key: LocaleKey) => string,
  entry: GlossaryEntry,
  hits: number,
  subset_parents: string[],
): string {
  const tooltip_lines = [
    t("quality_rule_editor.hit.hit_count").replace("{COUNT}", hits.toString()),
  ];

  if (subset_parents.length > 0) {
    tooltip_lines.push(t("quality_rule_editor.hit.subset_relations"));
    tooltip_lines.push(
      ...subset_parents.map((label) => {
        return `${entry.src} -> ${label}`;
      }),
    );
  }

  return tooltip_lines.join("\n");
}

/**
 * 将会话级统计缓存投影为页面只读状态，不复制规则事实。
 */
function build_glossary_hit_state_from_cache(
  statistics_cache: QualityRuleStatisticsCacheSnapshot,
): GlossaryHitState {
  // 页面只从质量统计缓存计算展示状态，不持有也不修改项目质量规则事实。
  return {
    running: isQualityRuleStatisticsCacheRunning(statistics_cache),
    entry_ids: statistics_cache.entry_ids,
    hits_by_entry_id: statistics_cache.hits_by_entry_id,
    subset_parents_by_entry_id: statistics_cache.subset_parents_by_entry_id,
  };
}

/**
 * 聚合术语表页面的项目快照、筛选状态、统计缓存与唯一写入口。
 *
 * 页面组件只消费该 Hook 暴露的快照和意图，避免绕过项目写锁直接修改后端状态。
 */
export function useGlossaryPageState() {
  const { t } = useI18n();

  const { project_snapshot, project_session_status = "ready" } = useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();
  const { navigate_to_route, push_proofreading_lookup_intent } = useAppNavigation();
  /** 将查询失败交给页面反馈入口。 */
  const handle_quality_rule_load_error = useCallback(
    (error: unknown): void => {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("glossary_page.feedback.load_failed")),
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
    rule_type: "glossary",
    project_path:
      project_snapshot.loaded && project_session_status === "ready" ? project_snapshot.path : "",
    session_ready: project_session_status === "ready",
    default_slice: DEFAULT_QUALITY_SLICE,
    normalize_slice: normalize_glossary_quality_slice,
    on_load_error: handle_quality_rule_load_error,
  });
  const enabled = project_snapshot.loaded ? quality_slice.enabled : true;
  const entries = project_snapshot.loaded ? quality_slice.entries : DEFAULT_QUALITY_SLICE.entries;

  const statistics_cache = useQualityRuleStatistics("glossary");
  const hit_state = useMemo<GlossaryHitState>(() => {
    return build_glossary_hit_state_from_cache(statistics_cache);
  }, [statistics_cache]);
  const hit_ready = isQualityRuleStatisticsCacheReady(statistics_cache);
  const hit_sort_available = hit_ready || hit_state.entry_ids !== null;
  const readonly = is_runtime_busy(runtime_snapshot);
  /** 组合本页筛选、排序和统计，交给公共表格维护结果。 */
  const build_table_result = useCallback(
    (filter_state: GlossaryFilterState, sort_state: AppTableSortState | null) => {
      return build_glossary_filter_result({
        entries,
        filter_state,
        sort_state,
        hit_sort_available,
        hit_state,
      });
    },
    [entries, hit_sort_available, hit_state],
  );
  const table = useQualityRuleTable({
    key: "quality:glossary",
    project_path:
      project_snapshot.loaded && project_session_status === "ready" ? project_snapshot.path : "",
    section_revision: quality_slice.section_revision,
    loaded: quality_status === "ready",
    readonly,
    entries,
    create_filter: create_empty_filter_state,
    sort_columns: GLOSSARY_SORT_FIELDS,
    reset_hit_sort: false, // 术语表保留命中排序意图，等待首次统计或刷新结果。
    build_result: build_table_result,
  });
  const {
    entry_ids,
    entry_index_by_id,
    sort_state,
    selected_entry_ids,
    reorder_disabled,
    set_pending_result_refresh,
  } = table;

  const completed_hit_entry_id_set = useMemo<ReadonlySet<GlossaryEntryId>>(() => {
    return new Set(hit_state.entry_ids ?? []);
  }, [hit_state.entry_ids]);

  const hit_badge_by_entry_id = useMemo<Record<GlossaryEntryId, GlossaryHitBadgeState>>(() => {
    const next_badge_by_entry_id: Record<GlossaryEntryId, GlossaryHitBadgeState> = {};
    if (!hit_ready && hit_state.entry_ids === null) {
      return next_badge_by_entry_id;
    }

    entries.forEach((entry, index) => {
      const entry_id = entry_ids[index];
      if (entry_id === undefined) {
        return;
      }

      const kind = resolve_quality_rule_hit_badge_kind(
        entry_id,
        hit_state,
        completed_hit_entry_id_set,
      );
      if (kind === null) {
        return;
      }

      const hits = hit_state.hits_by_entry_id[entry_id] ?? 0;
      const subset_parents = hit_state.subset_parents_by_entry_id[entry_id] ?? [];

      next_badge_by_entry_id[entry_id] = {
        kind,
        hits,
        subset_parents,
        tooltip: build_hit_badge_tooltip(t, entry, hits, subset_parents),
      };
    });

    return next_badge_by_entry_id;
  }, [completed_hit_entry_id_set, entries, entry_ids, hit_ready, hit_state, t]);

  const { apply_filter } = table;

  /** 用命中关系缩小当前规则结果范围。 */
  const search_entry_relations_from_hit = useCallback(
    (entry_id: GlossaryEntryId): void => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      const next_filter_state = {
        // 统计入口要把用户带回一条可解释的筛选路径，保持筛选条件完全显式。
        keyword: target_entry.src,
        scope: "src" as const,
        is_regex: false,
      };
      apply_filter(next_filter_state, sort_state);
    },
    [entries, entry_index_by_id, sort_state, apply_filter],
  );

  /** 提交启用状态并读取后端确认的规则快照。 */

  const validate_entry = useCallback(
    (entry: GlossaryEntryDraft): string | null =>
      entry.src === "" ? t("quality_rule_editor.feedback.source_required") : null,
    [t],
  );

  const presets = useQualityRulePresets(
    "glossary",
    entries.map(normalize_dialog_entry),
    "glossary_page.feedback.preset_failed",
  );
  const editing = useQualityRuleEditing({
    rule_type: "glossary",
    project_path:
      project_snapshot.loaded && project_session_status === "ready" ? project_snapshot.path : "",
    entries,
    section_revision: quality_slice.section_revision,
    readonly,
    reorder_disabled,
    empty_entry: EMPTY_ENTRY,
    normalize: normalize_dialog_entry,
    validate: validate_entry,
    selection: table.session,
    refresh: refresh_quality_rule_snapshot,
    set_result_refresh: set_pending_result_refresh,
    close_preset_menu: () => presets.set_preset_menu_open(false),
    export_file_name: "glossary.json",
    error_key: "glossary_page.feedback.save_failed",
  });
  const { save_entries_snapshot } = editing;
  /** 将大小写规则批量应用到当前选区。 */
  const toggle_case_sensitive_for_selected = useCallback(
    async (next_value: boolean): Promise<void> => {
      if (readonly || selected_entry_ids.length === 0) {
        return;
      }

      const selected_set = new Set(selected_entry_ids);
      const next_entries = entries.map((entry, index) => {
        if (!selected_set.has(entry_ids[index] ?? "")) {
          return entry;
        }

        return {
          ...entry,
          case_sensitive: next_value,
        };
      });

      await save_entries_snapshot(next_entries);
    },
    [entries, entry_ids, readonly, save_entries_snapshot, selected_entry_ids],
  );

  /** 用所选规则发起校对页查找。 */
  const query_entry_source_from_hit = useCallback(
    async (entry_id: GlossaryEntryId): Promise<void> => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      try {
        push_proofreading_lookup_intent(
          buildProofreadingLookupQuery({
            rule_type: "glossary",
            entry: normalize_dialog_entry(target_entry),
          }),
        );
        navigate_to_route("proofreading");
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("glossary_page.feedback.query_failed")),
        );
      }
    },
    [entries, entry_index_by_id, navigate_to_route, push_proofreading_lookup_intent, t],
  );

  return {
    editing,
    table,
    presets,
    quality_status,
    reload_quality_rule_snapshot,
    enabled,

    readonly,
    hit_ready,
    hit_sort_available,
    hit_badge_by_entry_id,

    update_enabled: editing.update_enabled,
    toggle_case_sensitive_for_selected,
    query_entry_source_from_hit,
    search_entry_relations_from_hit,
  };
}

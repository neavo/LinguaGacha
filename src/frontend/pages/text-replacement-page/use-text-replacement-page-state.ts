import { useQualityRuleTable } from "@frontend/features/quality-rule-editor/use-quality-rule-table";
import { useQualityRuleEditing } from "@frontend/features/quality-rule-editor/use-quality-rule-editing";
import { useQualityRulePresets } from "@frontend/features/quality-rule-editor/use-quality-rule-presets";
import { useCallback, useMemo } from "react";

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
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";

import {
  TEXT_REPLACEMENT_VARIANT_CONFIG,
  type TextReplacementVariant,
} from "@frontend/pages/text-replacement-page/config";
import {
  build_text_replacement_filter_result,
  sort_text_replacement_entries,
} from "@frontend/pages/text-replacement-page/filtering";
import { resolve_quality_rule_hit_badge_kind } from "@frontend/features/quality-rule-editor/quality-rule-filtering";

import type {
  TextReplacementEntry,
  TextReplacementEntryDraft,
  TextReplacementEntryId,
  TextReplacementFilterState,
  TextReplacementHitBadgeState,
  TextReplacementHitState,
} from "@frontend/pages/text-replacement-page/types";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";

import { compile_text_replacements } from "@shared/text/text-replacement-rules";

type TextReplacementQualitySlice = {
  enabled: boolean;
  entries: TextReplacementEntry[];
  section_revision: number;
};

// session 恢复排序的白名单，避免跨变体列 ID 污染表格。
const TEXT_REPLACEMENT_SORT_COLUMN_IDS = new Set(["src", "dst", "rule", "hit"]);

// 对话框总是克隆该模板，避免复用可变草稿引用。
const EMPTY_ENTRY: TextReplacementEntryDraft = {
  src: "",
  dst: "",
  regex: false,
  case_sensitive: false,
};
// 首次查询前使用与后端默认语义一致的只读切片。
const DEFAULT_QUALITY_SLICE: TextReplacementQualitySlice = {
  enabled: true,
  entries: [],
  section_revision: 0,
};

/** 新项目或清空筛选时的完整筛选状态。 */
function create_empty_filter_state(): TextReplacementFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
  };
}

/**
 * 在保存边界按替换规则字段白名单投影并裁掉文本两端空白，同时保留稳定条目 ID。
 */
function normalize_entry<Entry extends TextReplacementEntryDraft>(entry: Entry): Entry {
  return {
    entry_id: entry.entry_id,
    src: entry.src.trim(),
    dst: entry.dst.trim(),
    regex: entry.regex,
    case_sensitive: entry.case_sensitive,
  } as Entry;
}

/**
 * 将完整质量规则查询映射为页面状态。
 */
function normalize_text_replacement_quality_slice(
  slice: QualityRuleSlice<"pre_replacement" | "post_replacement">,
  section_revision: number,
): TextReplacementQualitySlice {
  return {
    enabled: slice.enabled,
    entries: slice.entries,
    section_revision,
  };
}

/**
 * 将命中数和子集父项关系合并成徽章的多行说明。
 */
function build_hit_badge_tooltip(
  t: (key: LocaleKey) => string,
  entry: TextReplacementEntry,
  hits: number,
  subset_parents: string[],
): string {
  const tooltip_lines = [
    t("quality_rule_editor.hit.hit_count").replace("{COUNT}", hits.toString()),
  ];

  if (subset_parents.length > 0) {
    tooltip_lines.push(t("text_replacement_page.hit.subset_relations"));
    tooltip_lines.push(
      ...subset_parents.map((label) => {
        return t("quality_rule_editor.hit.relation_line")
          .replace("{CHILD}", entry.src)
          .replace("{PARENT}", label);
      }),
    );
  }

  return tooltip_lines.join("\n");
}

/**
 * 将会话级统计缓存投影为页面只读状态，不复制规则事实。
 */
function build_text_replacement_hit_state_from_cache(
  statistics_cache: QualityRuleStatisticsCacheSnapshot,
): TextReplacementHitState {
  // 页面只从质量统计缓存计算展示状态，不持有也不修改替换规则事实。
  return {
    running: isQualityRuleStatisticsCacheRunning(statistics_cache),
    entry_ids: statistics_cache.entry_ids,
    hits_by_entry_id: statistics_cache.hits_by_entry_id,
    subset_parents_by_entry_id: statistics_cache.subset_parents_by_entry_id,
  };
}

/**
 * 按替换阶段聚合页面快照、筛选状态、统计缓存与唯一写入口。
 *
 * variant 只选择对应的项目字段与文案，所有写入仍统一经过项目会话的写锁。
 */
export function useTextReplacementPageState(variant: TextReplacementVariant) {
  const config = TEXT_REPLACEMENT_VARIANT_CONFIG[variant];
  const { t } = useI18n();

  const { navigate_to_route, push_proofreading_lookup_intent } = useAppNavigation();
  const { project_snapshot, project_session_status = "ready" } = useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();
  /** 将查询失败交给页面反馈入口。 */
  const handle_quality_rule_load_error = useCallback(
    (error: unknown): void => {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("text_replacement_page.feedback.load_failed")),
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
    rule_type: config.rule_type,
    project_path:
      project_snapshot.loaded && project_session_status === "ready" ? project_snapshot.path : "",
    session_ready: project_session_status === "ready",
    default_slice: DEFAULT_QUALITY_SLICE,
    normalize_slice: normalize_text_replacement_quality_slice,
    on_load_error: handle_quality_rule_load_error,
  });
  const enabled = project_snapshot.loaded ? quality_slice.enabled : true;
  const entries = project_snapshot.loaded ? quality_slice.entries : DEFAULT_QUALITY_SLICE.entries;

  const statistics_cache = useQualityRuleStatistics(config.rule_type);
  const hit_state = useMemo<TextReplacementHitState>(() => {
    return build_text_replacement_hit_state_from_cache(statistics_cache);
  }, [statistics_cache]);
  const hit_ready = isQualityRuleStatisticsCacheReady(statistics_cache);
  const readonly = is_runtime_busy(runtime_snapshot);
  /** 组合本页筛选、排序和统计，交给公共表格维护结果。 */
  const build_table_result = useCallback(
    (filter_state: TextReplacementFilterState, sort_state: AppTableSortState | null) => {
      const result = build_text_replacement_filter_result({ entries, filter_state });
      return {
        ...result,
        visible_entries: sort_text_replacement_entries(
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
    key: `quality:${config.rule_type}`,
    project_path:
      project_snapshot.loaded && project_session_status === "ready" ? project_snapshot.path : "",
    section_revision: quality_slice.section_revision,
    loaded: quality_status === "ready",
    readonly,
    entries,
    create_filter: create_empty_filter_state,
    sort_columns: TEXT_REPLACEMENT_SORT_COLUMN_IDS,
    reset_hit_sort: !hit_ready,
    build_result: build_table_result,
  });
  const {
    entry_ids,
    entry_index_by_id,
    selected_entry_ids,
    reorder_disabled,
    set_pending_result_refresh,
  } = table;

  const completed_hit_entry_id_set = useMemo<ReadonlySet<TextReplacementEntryId>>(() => {
    return new Set(hit_state.entry_ids ?? []);
  }, [hit_state.entry_ids]);

  const hit_badge_by_entry_id = useMemo<
    Record<TextReplacementEntryId, TextReplacementHitBadgeState>
  >(() => {
    const next_badge_by_entry_id: Record<TextReplacementEntryId, TextReplacementHitBadgeState> = {};
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

  /** 提交启用状态并读取后端确认的规则快照。 */

  /** 在提交前校验规则并反馈字段错误。 */
  const validate_entry = useCallback(
    (entry: TextReplacementEntryDraft): string | null => {
      if (entry.src === "") {
        return t("quality_rule_editor.feedback.source_required");
      }

      if (!entry.regex) {
        return null;
      }

      try {
        compile_text_replacements([entry]);
        return null;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        return `${t("quality_rule_editor.feedback.regex_invalid")}: ${detail}`;
      }
    },
    [t],
  );
  const presets = useQualityRulePresets(
    config.rule_type,
    entries.map(normalize_entry),
    "text_replacement_page.feedback.preset_failed",
  );
  const editing = useQualityRuleEditing({
    rule_type: config.rule_type,
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
    export_file_name: config.export_file_name,
    error_key: "text_replacement_page.feedback.save_failed",
  });
  const { save_entries_snapshot } = editing;

  /** 将正则开关批量应用到当前选区。 */
  const toggle_regex_for_selected = useCallback(
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
          regex: next_value,
        };
      });

      await save_entries_snapshot(next_entries);
    },
    [entries, entry_ids, readonly, save_entries_snapshot, selected_entry_ids],
  );

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
  const query_entry_source = useCallback(
    async (entry_id: TextReplacementEntryId): Promise<void> => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      try {
        push_proofreading_lookup_intent(
          buildProofreadingLookupQuery({
            rule_type: config.rule_type,
            entry: normalize_entry(target_entry),
          }),
        );
        navigate_to_route("proofreading");
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("text_replacement_page.feedback.query_failed")),
        );
      }
    },
    [
      config.rule_type,
      entries,
      entry_index_by_id,
      navigate_to_route,
      push_proofreading_lookup_intent,
      t,
    ],
  );

  const { apply_filter } = table;

  /** 用命中关系缩小当前规则结果范围。 */
  const search_entry_relations_from_hit = useCallback(
    (entry_id: TextReplacementEntryId): void => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      const next_filter_state = {
        keyword: target_entry.src,
        scope: "src" as const,
        is_regex: false,
      };
      apply_filter(next_filter_state, null);
    },
    [entries, entry_index_by_id, apply_filter],
  );

  return {
    editing,
    table,
    presets,
    quality_status,
    reload_quality_rule_snapshot,
    title_key: config.title_key,
    enabled,
    entries,

    readonly,
    hit_state,
    hit_ready,
    hit_badge_by_entry_id,

    update_enabled: (enabled: boolean) => editing.update_meta_with_feedback({ enabled }),
    toggle_regex_for_selected,
    toggle_case_sensitive_for_selected,
    query_entry_source,
    search_entry_relations_from_hit,
  };
}

import type { QualityStatisticsDependencySnapshot } from "@/app/project/quality/quality-statistics-auto";

export const QUALITY_STATISTICS_RULE_TYPES = [
  "glossary",
  "pre_replacement",
  "post_replacement",
  "text_preserve",
] as const;

export type QualityStatisticsRuleType = (typeof QUALITY_STATISTICS_RULE_TYPES)[number];

export type QualityStatisticsCacheSnapshot = {
  running: boolean;
  ready: boolean;
  stale: boolean;
  failed: boolean;
  current_snapshot: QualityStatisticsDependencySnapshot | null;
  completed_snapshot: QualityStatisticsDependencySnapshot | null;
  completed_entry_ids: string[];
  matched_count_by_entry_id: Record<string, number>;
  subset_parent_labels_by_entry_id: Record<string, string[]>;
  last_error: Error | null;
  request_token: number;
  updated_at: number | null;
};

export type QualityStatisticsStoreSnapshot = {
  project_path: string;
  caches: Record<QualityStatisticsRuleType, QualityStatisticsCacheSnapshot>;
};

type QualityStatisticsStoreListener = () => void;

export type QualityStatisticsStore = {
  getSnapshot: () => QualityStatisticsStoreSnapshot;
  subscribe: (listener: QualityStatisticsStoreListener) => () => void;
  reset: (project_path: string) => void;
  updateCache: (
    rule_type: QualityStatisticsRuleType,
    updater: (cache: QualityStatisticsCacheSnapshot) => QualityStatisticsCacheSnapshot,
  ) => void;
};

export function createEmptyQualityStatisticsCacheSnapshot(): QualityStatisticsCacheSnapshot {
  return {
    running: false,
    ready: false,
    stale: false,
    failed: false,
    current_snapshot: null,
    completed_snapshot: null,
    completed_entry_ids: [],
    matched_count_by_entry_id: {},
    subset_parent_labels_by_entry_id: {},
    last_error: null,
    request_token: 0,
    updated_at: null,
  };
}

function createEmptyQualityStatisticsStoreSnapshot(
  project_path: string,
): QualityStatisticsStoreSnapshot {
  return {
    project_path,
    caches: {
      glossary: createEmptyQualityStatisticsCacheSnapshot(),
      pre_replacement: createEmptyQualityStatisticsCacheSnapshot(),
      post_replacement: createEmptyQualityStatisticsCacheSnapshot(),
      text_preserve: createEmptyQualityStatisticsCacheSnapshot(),
    },
  };
}

export function buildQualityStatisticsResultMap(
  cache: QualityStatisticsCacheSnapshot,
): Record<string, { matched_item_count: number; subset_parents: string[] }> {
  const entry_ids = new Set<string>([
    ...cache.completed_entry_ids,
    ...Object.keys(cache.matched_count_by_entry_id),
    ...Object.keys(cache.subset_parent_labels_by_entry_id),
  ]);

  return Object.fromEntries(
    [...entry_ids].map((entry_id) => {
      return [
        entry_id,
        {
          matched_item_count: cache.matched_count_by_entry_id[entry_id] ?? 0,
          subset_parents: cache.subset_parent_labels_by_entry_id[entry_id] ?? [],
        },
      ];
    }),
  );
}

export function buildQualityStatisticsCacheFromResults(args: {
  previous_cache: QualityStatisticsCacheSnapshot;
  current_snapshot: QualityStatisticsDependencySnapshot;
  results: Record<string, { matched_item_count?: number; subset_parents?: string[] }>;
  request_token?: number;
}): QualityStatisticsCacheSnapshot {
  return {
    ...args.previous_cache,
    running: false,
    ready: true,
    stale: false,
    failed: false,
    current_snapshot: args.current_snapshot,
    completed_snapshot: args.current_snapshot,
    completed_entry_ids: args.current_snapshot.rules.map((rule) => {
      return rule.key;
    }),
    matched_count_by_entry_id: Object.fromEntries(
      Object.entries(args.results).map(([entry_id, result]) => {
        return [entry_id, result.matched_item_count ?? 0];
      }),
    ),
    subset_parent_labels_by_entry_id: Object.fromEntries(
      Object.entries(args.results).map(([entry_id, result]) => {
        return [entry_id, result.subset_parents ?? []];
      }),
    ),
    last_error: null,
    request_token: args.request_token ?? args.previous_cache.request_token,
    updated_at: Date.now(),
  };
}

export function createQualityStatisticsStore(): QualityStatisticsStore {
  let snapshot = createEmptyQualityStatisticsStoreSnapshot("");
  const listeners = new Set<QualityStatisticsStoreListener>();

  function emit_change(): void {
    listeners.forEach((listener) => {
      listener();
    });
  }

  return {
    getSnapshot(): QualityStatisticsStoreSnapshot {
      return snapshot;
    },
    subscribe(listener: QualityStatisticsStoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset(project_path: string): void {
      snapshot = createEmptyQualityStatisticsStoreSnapshot(project_path);
      emit_change();
    },
    updateCache(
      rule_type: QualityStatisticsRuleType,
      updater: (cache: QualityStatisticsCacheSnapshot) => QualityStatisticsCacheSnapshot,
    ): void {
      const previous_cache = snapshot.caches[rule_type];
      const next_cache = updater(previous_cache);

      snapshot = {
        ...snapshot,
        caches: {
          ...snapshot.caches,
          [rule_type]: next_cache,
        },
      };
      emit_change();
    },
  };
}

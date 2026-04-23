import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { createQualityStatisticsScheduler } from "@/app/project-runtime/quality-statistics-scheduler";
import {
  createQualityStatisticsStore,
  type QualityStatisticsCacheSnapshot,
  type QualityStatisticsRuleType,
  type QualityStatisticsStore,
} from "@/app/project-runtime/quality-statistics-store";
import type { ProjectStoreState } from "@/app/project-runtime/project-store";
import { useDesktopRuntime } from "@/app/state/use-desktop-runtime";

type QualityStatisticsContextValue = {
  scheduler: ReturnType<typeof createQualityStatisticsScheduler>;
  store: QualityStatisticsStore;
};

const QualityStatisticsContext = createContext<QualityStatisticsContextValue | null>(null);

function extract_quality_revisions(
  state: ProjectStoreState,
): Record<QualityStatisticsRuleType, number> {
  return {
    glossary: Number(state.quality.glossary.revision ?? 0),
    pre_replacement: Number(state.quality.pre_replacement.revision ?? 0),
    post_replacement: Number(state.quality.post_replacement.revision ?? 0),
    text_preserve: Number(state.quality.text_preserve.revision ?? 0),
  };
}

export function QualityStatisticsProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot, project_store, project_warmup_status } = useDesktopRuntime();
  const project_store_state = useSyncExternalStore(
    project_store.subscribe,
    project_store.getState,
    project_store.getState,
  );
  const store_ref = useRef<QualityStatisticsStore | null>(null);
  if (store_ref.current === null) {
    store_ref.current = createQualityStatisticsStore();
  }

  const project_store_state_ref = useRef(project_store_state);
  project_store_state_ref.current = project_store_state;
  const scheduler_ref = useRef<ReturnType<typeof createQualityStatisticsScheduler> | null>(null);
  if (scheduler_ref.current === null) {
    scheduler_ref.current = createQualityStatisticsScheduler({
      store: store_ref.current,
      get_project_state: () => {
        return project_store_state_ref.current;
      },
    });
  }

  const previous_project_path_ref = useRef("");
  const previous_items_revision_ref = useRef<number | null>(null);
  const previous_quality_revisions_ref = useRef<Record<QualityStatisticsRuleType, number>>({
    glossary: 0,
    pre_replacement: 0,
    post_replacement: 0,
    text_preserve: 0,
  });
  const previous_warmup_ready_ref = useRef(false);

  useEffect(() => {
    const scheduler = scheduler_ref.current;
    return () => {
      scheduler?.dispose();
    };
  }, []);

  useEffect(() => {
    const scheduler = scheduler_ref.current;
    if (scheduler === null) {
      return;
    }

    if (!project_snapshot.loaded || project_snapshot.path === "") {
      previous_project_path_ref.current = "";
      previous_items_revision_ref.current = null;
      previous_quality_revisions_ref.current = {
        glossary: 0,
        pre_replacement: 0,
        post_replacement: 0,
        text_preserve: 0,
      };
      previous_warmup_ready_ref.current = false;
      scheduler.resetProject("");
      return;
    }

    if (previous_project_path_ref.current !== project_snapshot.path) {
      previous_project_path_ref.current = project_snapshot.path;
      previous_items_revision_ref.current = Number(
        project_store_state.revisions.sections.items ?? 0,
      );
      previous_quality_revisions_ref.current = extract_quality_revisions(project_store_state);
      previous_warmup_ready_ref.current = false;
      scheduler.resetProject(project_snapshot.path);
    }
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    project_store_state.revisions.sections.items,
  ]);

  useEffect(() => {
    const scheduler = scheduler_ref.current;
    if (scheduler === null || !project_snapshot.loaded) {
      previous_warmup_ready_ref.current = false;
      return;
    }

    const warmup_ready = project_warmup_status === "ready";
    if (warmup_ready && !previous_warmup_ready_ref.current) {
      scheduler.warmupAll();
    }

    previous_warmup_ready_ref.current = warmup_ready;
  }, [project_snapshot.loaded, project_warmup_status]);

  useEffect(() => {
    const scheduler = scheduler_ref.current;
    if (scheduler === null || !project_snapshot.loaded || project_snapshot.path === "") {
      return;
    }

    const current_items_revision = Number(project_store_state.revisions.sections.items ?? 0);
    const current_quality_revisions = extract_quality_revisions(project_store_state);

    if (project_warmup_status === "ready") {
      if (
        previous_items_revision_ref.current !== null &&
        previous_items_revision_ref.current !== current_items_revision
      ) {
        scheduler.markItemsDirty();
      }

      (Object.keys(current_quality_revisions) as QualityStatisticsRuleType[]).forEach(
        (rule_type) => {
          if (
            previous_quality_revisions_ref.current[rule_type] !==
            current_quality_revisions[rule_type]
          ) {
            scheduler.markQualityDirty(rule_type);
          }
        },
      );
    }

    previous_items_revision_ref.current = current_items_revision;
    previous_quality_revisions_ref.current = current_quality_revisions;
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    project_store_state.quality.glossary.revision,
    project_store_state.quality.pre_replacement.revision,
    project_store_state.quality.post_replacement.revision,
    project_store_state.quality.text_preserve.revision,
    project_store_state.revisions.sections.items,
    project_warmup_status,
  ]);

  const context_value = useMemo<QualityStatisticsContextValue>(() => {
    return {
      scheduler: scheduler_ref.current!,
      store: store_ref.current!,
    };
  }, []);

  return (
    <QualityStatisticsContext.Provider value={context_value}>
      {props.children}
    </QualityStatisticsContext.Provider>
  );
}

function useQualityStatisticsContext(): QualityStatisticsContextValue {
  const context_value = useContext(QualityStatisticsContext);
  if (context_value === null) {
    throw new Error("useQualityStatistics 必须在 QualityStatisticsProvider 内使用。");
  }

  return context_value;
}

export function useQualityStatistics(
  rule_type: QualityStatisticsRuleType,
): QualityStatisticsCacheSnapshot {
  const { scheduler, store } = useQualityStatisticsContext();
  const cache_snapshot = useSyncExternalStore(
    store.subscribe,
    () => {
      return store.getSnapshot().caches[rule_type];
    },
    () => {
      return store.getSnapshot().caches[rule_type];
    },
  );

  useEffect(() => {
    if (
      !cache_snapshot.running &&
      !cache_snapshot.failed &&
      (!cache_snapshot.ready || cache_snapshot.stale)
    ) {
      scheduler.requestForeground(rule_type);
    }
  }, [
    cache_snapshot.failed,
    cache_snapshot.ready,
    cache_snapshot.running,
    cache_snapshot.stale,
    rule_type,
    scheduler,
  ]);

  return cache_snapshot;
}

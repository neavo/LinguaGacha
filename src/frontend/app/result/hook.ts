import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  PRESERVE_RESULT_REFRESH,
  REBUILD_RESULT_REFRESH,
  is_result_refresh_ready,
  reconcile_result_snapshot,
  type PendingResultRefresh,
  type ResultSnapshot,
} from "./snapshot";
import type { ProjectDataSection } from "@shared/project-event";

type ResultSnapshotStateOptions<Query, Id extends string> = {
  project_path: string;
  section: ProjectDataSection;
  section_revision: number;
  has_active_query: boolean;
  valid_ids: readonly Id[];
  build_snapshot: () => ResultSnapshot<Query, Id>;
};

type ResultSnapshotState<Query, Id extends string> = {
  result_snapshot: ResultSnapshot<Query, Id> | null;
  set_result_snapshot: Dispatch<SetStateAction<ResultSnapshot<Query, Id> | null>>;
  set_pending_result_refresh: Dispatch<SetStateAction<PendingResultRefresh | null>>;
  reset_result_snapshot: () => void;
};

// 结果型页面共用同一套 revision 门闩，避免每个页面重复猜 HTTP 写入与 SSE 的先后关系。
export function useResultSnapshotState<Query, Id extends string>(
  options: ResultSnapshotStateOptions<Query, Id>,
): ResultSnapshotState<Query, Id> {
  const { project_path, section, section_revision, has_active_query, valid_ids, build_snapshot } =
    options;
  const [result_snapshot, set_result_snapshot] = useState<ResultSnapshot<Query, Id> | null>(null);
  const [pending_result_refresh, set_pending_result_refresh] =
    useState<PendingResultRefresh | null>(null);
  const source_checkpoint_ref = useRef({ projectPath: "", revision: 0 });

  useEffect(() => {
    const current_source_checkpoint = {
      projectPath: project_path,
      sections: {
        [section]: section_revision,
      },
    };
    const previous_source_checkpoint = source_checkpoint_ref.current;
    const source_checkpoint_changed =
      previous_source_checkpoint.projectPath !== current_source_checkpoint.projectPath ||
      previous_source_checkpoint.revision !== section_revision;
    const should_rebuild_for_source_change =
      source_checkpoint_changed &&
      (previous_source_checkpoint.projectPath !== current_source_checkpoint.projectPath ||
        !has_active_query);
    const should_rebuild_from_source = is_result_refresh_ready({
      request: pending_result_refresh,
      current_source_checkpoint,
    });

    set_result_snapshot((previous_snapshot) => {
      return reconcile_result_snapshot({
        previous_snapshot,
        current_snapshot: build_snapshot(),
        valid_id_set: new Set(valid_ids),
        refresh_policy: should_rebuild_from_source
          ? pending_result_refresh?.policy
          : should_rebuild_for_source_change
            ? REBUILD_RESULT_REFRESH
            : PRESERVE_RESULT_REFRESH,
      });
    });

    source_checkpoint_ref.current = {
      projectPath: current_source_checkpoint.projectPath,
      revision: section_revision,
    };
    if (should_rebuild_from_source) {
      set_pending_result_refresh(null);
    }
  }, [
    build_snapshot,
    has_active_query,
    project_path,
    section,
    section_revision,
    valid_ids,
    pending_result_refresh,
  ]);

  const reset_result_snapshot = useCallback((): void => {
    set_result_snapshot(null);
    set_pending_result_refresh(null);
  }, []);

  return {
    result_snapshot,
    set_result_snapshot,
    set_pending_result_refresh,
    reset_result_snapshot,
  };
}

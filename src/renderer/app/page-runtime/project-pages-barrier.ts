import type {
  ProjectDataSection,
  ProjectDataSectionRevisions,
} from "@/project/store/project-store";

export type ProjectPagesBarrierKind =
  | "project_warmup"
  | "workbench_file_mutation"
  | "project_cache_refresh"
  | "proofreading_cache_refresh";

export type ProjectPagesBarrierCheckpoint = {
  projectPath: string;
  workbenchConsumedRevisions: ProjectDataSectionRevisions;
  proofreadingConsumedRevisions: ProjectDataSectionRevisions;
};

export type ProjectPagesBarrierOptions = {
  projectPath?: string;
  checkpoint?: ProjectPagesBarrierCheckpoint | null;
};

export type ProjectPagesBarrierState = {
  projectLoaded: boolean;
  projectPath: string;
  projectSectionRevisions: ProjectDataSectionRevisions;
  projectWarmupReady: boolean;
  workbenchFileOpRunning: boolean;
  workbenchIsRefreshing: boolean;
  workbenchConsumedRevisions: ProjectDataSectionRevisions;
  workbenchRequiredSections: ProjectDataSection[];
  workbenchSettledProjectPath: string;
  proofreadingIsRefreshing: boolean;
  proofreadingConsumedRevisions: ProjectDataSectionRevisions;
  proofreadingRequiredSections: ProjectDataSection[];
  proofreadingSettledProjectPath: string;
};

type CacheBarrierState = {
  isRefreshing: boolean;
  consumedRevisions: ProjectDataSectionRevisions;
  requiredSections: ProjectDataSection[];
  settledProjectPath: string;
};

export function createProjectPagesBarrierCheckpoint(
  args: Pick<
    ProjectPagesBarrierState,
    "projectPath" | "workbenchConsumedRevisions" | "proofreadingConsumedRevisions"
  >,
): ProjectPagesBarrierCheckpoint {
  return {
    projectPath: args.projectPath,
    workbenchConsumedRevisions: { ...args.workbenchConsumedRevisions },
    proofreadingConsumedRevisions: { ...args.proofreadingConsumedRevisions },
  };
}

function resolveTargetProjectPath(
  state: ProjectPagesBarrierState,
  options: ProjectPagesBarrierOptions,
): string {
  const explicitProjectPath = options.projectPath?.trim() ?? "";
  if (explicitProjectPath !== "") {
    return explicitProjectPath;
  }

  const checkpointProjectPath = options.checkpoint?.projectPath.trim() ?? "";
  if (checkpointProjectPath !== "") {
    return checkpointProjectPath;
  }

  return state.projectPath;
}

/**
 * 派生缓存只在声明依赖的 section revision 全部覆盖当前 ProjectStore 时才算 ready
 */
function coversProjectDataRevisions(args: {
  consumedRevisions: ProjectDataSectionRevisions;
  currentRevisions: ProjectDataSectionRevisions;
  requiredSections: ProjectDataSection[];
}): boolean {
  return args.requiredSections.every((section) => {
    return (args.consumedRevisions[section] ?? 0) >= (args.currentRevisions[section] ?? 0);
  });
}

function isProjectWarmupReady(
  state: ProjectPagesBarrierState,
  targetProjectPath: string,
  _checkpoint: ProjectPagesBarrierCheckpoint | null | undefined,
): boolean {
  if (
    !state.projectLoaded ||
    targetProjectPath === "" ||
    state.projectPath !== targetProjectPath ||
    !state.projectWarmupReady ||
    state.workbenchSettledProjectPath !== targetProjectPath
  ) {
    return false;
  }

  return coversProjectDataRevisions({
    consumedRevisions: state.workbenchConsumedRevisions,
    currentRevisions: state.projectSectionRevisions,
    requiredSections: state.workbenchRequiredSections,
  });
}

function isCacheBarrierReady(args: {
  state: ProjectPagesBarrierState;
  cacheState: CacheBarrierState;
  targetProjectPath: string;
}): boolean {
  if (!args.state.projectLoaded) {
    return true;
  }

  if (args.targetProjectPath !== "" && args.state.projectPath !== args.targetProjectPath) {
    return true;
  }

  if (args.cacheState.settledProjectPath !== args.targetProjectPath) {
    return false;
  }

  if (args.cacheState.isRefreshing) {
    return false;
  }

  return coversProjectDataRevisions({
    consumedRevisions: args.cacheState.consumedRevisions,
    currentRevisions: args.state.projectSectionRevisions,
    requiredSections: args.cacheState.requiredSections,
  });
}

export function isProjectPagesBarrierReady(
  kind: ProjectPagesBarrierKind,
  state: ProjectPagesBarrierState,
  options: ProjectPagesBarrierOptions = {},
): boolean {
  const targetProjectPath = resolveTargetProjectPath(state, options);

  if (kind === "project_warmup") {
    return isProjectWarmupReady(state, targetProjectPath, options.checkpoint);
  }

  if (kind === "workbench_file_mutation") {
    if (!state.projectLoaded) {
      return true;
    }

    if (targetProjectPath !== "" && state.projectPath !== targetProjectPath) {
      return true;
    }

    if (state.workbenchFileOpRunning) {
      return false;
    }

    return (
      isCacheBarrierReady({
        state,
        cacheState: {
          isRefreshing: state.workbenchIsRefreshing,
          consumedRevisions: state.workbenchConsumedRevisions,
          requiredSections: state.workbenchRequiredSections,
          settledProjectPath: state.workbenchSettledProjectPath,
        },
        targetProjectPath,
      }) &&
      isCacheBarrierReady({
        state,
        cacheState: {
          isRefreshing: state.proofreadingIsRefreshing,
          consumedRevisions: state.proofreadingConsumedRevisions,
          requiredSections: state.proofreadingRequiredSections,
          settledProjectPath: state.proofreadingSettledProjectPath,
        },
        targetProjectPath,
      })
    );
  }

  if (kind === "project_cache_refresh") {
    return isCacheBarrierReady({
      state,
      cacheState: {
        isRefreshing: state.workbenchIsRefreshing,
        consumedRevisions: state.workbenchConsumedRevisions,
        requiredSections: state.workbenchRequiredSections,
        settledProjectPath: state.workbenchSettledProjectPath,
      },
      targetProjectPath,
    });
  }

  return isCacheBarrierReady({
    state,
    cacheState: {
      isRefreshing: state.proofreadingIsRefreshing,
      consumedRevisions: state.proofreadingConsumedRevisions,
      requiredSections: state.proofreadingRequiredSections,
      settledProjectPath: state.proofreadingSettledProjectPath,
    },
    targetProjectPath,
  });
}

export type ProjectPagesBarrierKind =
  | 'project_warmup'
  | 'workbench_file_mutation'
  | 'project_cache_refresh'
  | 'proofreading_cache_refresh'

export type ProjectPagesBarrierCheckpoint = {
  projectPath: string
  workbenchLastLoadedAt: number | null
  proofreadingLastLoadedAt: number | null
}

export type ProjectPagesBarrierOptions = {
  projectPath?: string
  checkpoint?: ProjectPagesBarrierCheckpoint | null
}

export type ProjectPagesBarrierState = {
  projectLoaded: boolean
  projectPath: string
  projectWarmupReady: boolean
  workbenchFileOpRunning: boolean
  workbenchCacheStale: boolean
  workbenchIsRefreshing: boolean
  workbenchLastLoadedAt: number | null
  workbenchSettledProjectPath: string
  proofreadingCacheStale: boolean
  proofreadingIsRefreshing: boolean
  proofreadingLastLoadedAt: number | null
  proofreadingSettledProjectPath: string
}

type CacheBarrierState = {
  cacheStale: boolean
  isRefreshing: boolean
  lastLoadedAt: number | null
  settledProjectPath: string
}

export function createProjectPagesBarrierCheckpoint(args: Pick<
  ProjectPagesBarrierState,
  'projectPath' | 'workbenchLastLoadedAt' | 'proofreadingLastLoadedAt'
>): ProjectPagesBarrierCheckpoint {
  return {
    projectPath: args.projectPath,
    workbenchLastLoadedAt: args.workbenchLastLoadedAt,
    proofreadingLastLoadedAt: args.proofreadingLastLoadedAt,
  }
}

function resolveTargetProjectPath(
  state: ProjectPagesBarrierState,
  options: ProjectPagesBarrierOptions,
): string {
  const explicitProjectPath = options.projectPath?.trim() ?? ''
  if (explicitProjectPath !== '') {
    return explicitProjectPath
  }

  const checkpointProjectPath = options.checkpoint?.projectPath.trim() ?? ''
  if (checkpointProjectPath !== '') {
    return checkpointProjectPath
  }

  return state.projectPath
}

function hasLastLoadedAdvanced(
  currentLastLoadedAt: number | null,
  previousLastLoadedAt: number | null,
): boolean {
  if (currentLastLoadedAt === null) {
    return false
  }

  if (previousLastLoadedAt === null) {
    return true
  }

  return currentLastLoadedAt > previousLastLoadedAt
}

function hasWorkbenchMutationCacheAdvanced(
  state: ProjectPagesBarrierState,
  checkpoint: ProjectPagesBarrierCheckpoint | null | undefined,
): boolean {
  if (checkpoint === null || checkpoint === undefined) {
    return true
  }

  return (
    hasLastLoadedAdvanced(
      state.workbenchLastLoadedAt,
      checkpoint.workbenchLastLoadedAt,
    )
    || hasLastLoadedAdvanced(
      state.proofreadingLastLoadedAt,
      checkpoint.proofreadingLastLoadedAt,
    )
  )
}

function isCacheBarrierReady(args: {
  state: ProjectPagesBarrierState
  cacheState: CacheBarrierState
  targetProjectPath: string
  previousLastLoadedAt: number | null
}): boolean {
  if (!args.state.projectLoaded) {
    return true
  }

  if (
    args.targetProjectPath !== ''
    && args.state.projectPath !== args.targetProjectPath
  ) {
    return true
  }

  if (args.cacheState.settledProjectPath !== args.targetProjectPath) {
    return false
  }

  if (args.cacheState.cacheStale || args.cacheState.isRefreshing) {
    return false
  }

  return hasLastLoadedAdvanced(
    args.cacheState.lastLoadedAt,
    args.previousLastLoadedAt,
  )
}

export function isProjectPagesBarrierReady(
  kind: ProjectPagesBarrierKind,
  state: ProjectPagesBarrierState,
  options: ProjectPagesBarrierOptions = {},
): boolean {
  const targetProjectPath = resolveTargetProjectPath(state, options)

  if (kind === 'project_warmup') {
    return (
      state.projectLoaded
      && targetProjectPath !== ''
      && state.projectPath === targetProjectPath
      && state.projectWarmupReady
    )
  }

  if (kind === 'workbench_file_mutation') {
    if (!state.projectLoaded) {
      return true
    }

    if (
      targetProjectPath !== ''
      && state.projectPath !== targetProjectPath
    ) {
      return true
    }

    if (state.workbenchFileOpRunning) {
      return false
    }

    return (
      hasWorkbenchMutationCacheAdvanced(state, options.checkpoint)
      && isCacheBarrierReady({
        state,
        cacheState: {
          cacheStale: state.workbenchCacheStale,
          isRefreshing: state.workbenchIsRefreshing,
          lastLoadedAt: state.workbenchLastLoadedAt,
          settledProjectPath: state.workbenchSettledProjectPath,
        },
        targetProjectPath,
        previousLastLoadedAt: null,
      })
      && isCacheBarrierReady({
        state,
        cacheState: {
          cacheStale: state.proofreadingCacheStale,
          isRefreshing: state.proofreadingIsRefreshing,
          lastLoadedAt: state.proofreadingLastLoadedAt,
          settledProjectPath: state.proofreadingSettledProjectPath,
        },
        targetProjectPath,
        previousLastLoadedAt: null,
      })
    )
  }

  if (kind === 'project_cache_refresh') {
    return isCacheBarrierReady({
      state,
      cacheState: {
        cacheStale: state.workbenchCacheStale,
        isRefreshing: state.workbenchIsRefreshing,
        lastLoadedAt: state.workbenchLastLoadedAt,
        settledProjectPath: state.workbenchSettledProjectPath,
      },
      targetProjectPath,
      previousLastLoadedAt: options.checkpoint?.workbenchLastLoadedAt ?? null,
    })
  }

  return isCacheBarrierReady({
    state,
    cacheState: {
      cacheStale: state.proofreadingCacheStale,
      isRefreshing: state.proofreadingIsRefreshing,
      lastLoadedAt: state.proofreadingLastLoadedAt,
      settledProjectPath: state.proofreadingSettledProjectPath,
    },
    targetProjectPath,
    previousLastLoadedAt: options.checkpoint?.proofreadingLastLoadedAt ?? null,
  })
}

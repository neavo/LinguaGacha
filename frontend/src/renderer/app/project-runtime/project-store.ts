export type ProjectStoreStage =
  | 'project'
  | 'files'
  | 'items'
  | 'quality'
  | 'prompts'
  | 'analysis'
  | 'proofreading'
  | 'task'

export type ProjectStoreSectionRevisions = Partial<Record<ProjectStoreStage, number>>

export type ProjectStoreProjectState = {
  path: string
  loaded: boolean
}

export type ProjectStoreQualityRuleSlice = {
  entries: Array<Record<string, unknown>>
  enabled: boolean
  mode: string
  revision: number
}

export type ProjectStoreQualityState = {
  glossary: ProjectStoreQualityRuleSlice
  pre_replacement: ProjectStoreQualityRuleSlice
  post_replacement: ProjectStoreQualityRuleSlice
  text_preserve: ProjectStoreQualityRuleSlice
}

export type ProjectStorePromptSlice = {
  text: string
  enabled: boolean
  revision: number
}

export type ProjectStorePromptsState = {
  translation: ProjectStorePromptSlice
  analysis: ProjectStorePromptSlice
}

export type ProjectStoreProofreadingState = {
  revision: number
}

export type ProjectStoreSectionStateMap = {
  project: ProjectStoreProjectState
  files: Record<string, unknown>
  items: Record<string, unknown>
  quality: ProjectStoreQualityState
  prompts: ProjectStorePromptsState
  analysis: Record<string, unknown>
  proofreading: ProjectStoreProofreadingState
  task: Record<string, unknown>
}

export type ProjectStoreState = ProjectStoreSectionStateMap & {
  revisions: {
    projectRevision: number
    sections: ProjectStoreSectionRevisions
  }
}

export type ProjectStoreBootstrapPayload = {
  project?: ProjectStoreState['project']
  files?: ProjectStoreState['files']
  items?: ProjectStoreState['items']
  quality?: ProjectStoreState['quality']
  prompts?: ProjectStoreState['prompts']
  analysis?: ProjectStoreState['analysis']
  proofreading?: ProjectStoreState['proofreading']
  task?: ProjectStoreState['task']
  revisions?: Partial<ProjectStoreState['revisions']> & {
    sections?: ProjectStoreSectionRevisions
  }
}

type ProjectStoreRecordPatchOperation = {
  op: 'merge_files' | 'merge_items'
  files?: Array<Record<string, unknown>>
  items?: Array<Record<string, unknown>>
}

type ProjectStoreReplacePatchOperation = {
  op:
    | 'replace_project'
    | 'replace_quality'
    | 'replace_prompts'
    | 'replace_analysis'
    | 'replace_proofreading'
    | 'replace_task'
  project?: ProjectStoreState['project']
  quality?: ProjectStoreState['quality']
  prompts?: ProjectStoreState['prompts']
  analysis?: ProjectStoreState['analysis']
  proofreading?: ProjectStoreState['proofreading']
  task?: ProjectStoreState['task']
}

export type ProjectStorePatchOperation =
  | ProjectStoreRecordPatchOperation
  | ProjectStoreReplacePatchOperation

export type ProjectStorePatchEvent = {
  source: string
  projectRevision: number
  updatedSections: ProjectStoreStage[]
  patch: ProjectStorePatchOperation[]
  sectionRevisions?: ProjectStoreSectionRevisions
}

export type ProjectStoreListener = () => void
export type ProjectStorePatchRevisionMode = 'merge' | 'exact'

type ProjectStorePatchOptions = {
  revisionMode?: ProjectStorePatchRevisionMode
}

export function isProjectStoreStage(value: string): value is ProjectStoreStage {
  return [
    'project',
    'files',
    'items',
    'quality',
    'prompts',
    'analysis',
    'proofreading',
    'task',
  ].includes(value)
}

type ProjectStoreApi = {
  getState: () => ProjectStoreState
  subscribe: (listener: ProjectStoreListener) => () => void
  reset: () => void
  applyBootstrapStage: (
    stage: ProjectStoreStage,
    payload: ProjectStoreBootstrapPayload,
  ) => void
  applyProjectPatch: (
    event: ProjectStorePatchEvent,
    options?: ProjectStorePatchOptions,
  ) => void
}

function createEmptyQualityRuleSlice(): ProjectStoreQualityRuleSlice {
  return {
    entries: [],
    enabled: false,
    mode: 'off',
    revision: 0,
  }
}

function createEmptyPromptsState(): ProjectStorePromptsState {
  return {
    translation: {
      text: '',
      enabled: false,
      revision: 0,
    },
    analysis: {
      text: '',
      enabled: false,
      revision: 0,
    },
  }
}

function createEmptyProofreadingState(): ProjectStoreProofreadingState {
  return {
    revision: 0,
  }
}

const INITIAL_STATE: ProjectStoreState = {
  project: {
    path: '',
    loaded: false,
  },
  files: {},
  items: {},
  quality: {
    glossary: createEmptyQualityRuleSlice(),
    pre_replacement: createEmptyQualityRuleSlice(),
    post_replacement: createEmptyQualityRuleSlice(),
    text_preserve: createEmptyQualityRuleSlice(),
  },
  prompts: createEmptyPromptsState(),
  analysis: {},
  proofreading: createEmptyProofreadingState(),
  task: {},
  revisions: {
    projectRevision: 0,
    sections: {},
  },
}

function mergeRevisions(
  current_revisions: ProjectStoreState['revisions'],
  incoming_revisions: ProjectStoreBootstrapPayload['revisions'],
): ProjectStoreState['revisions'] {
  if (incoming_revisions === undefined) {
    return current_revisions
  }

  return {
    projectRevision: incoming_revisions.projectRevision ?? current_revisions.projectRevision,
    sections: {
      ...current_revisions.sections,
      ...incoming_revisions.sections,
    },
  }
}

function mergePatchRevisions(args: {
  currentRevisions: ProjectStoreState['revisions']
  projectRevision: number
  updatedSections: ProjectStoreStage[]
  sectionRevisions?: ProjectStoreSectionRevisions
}): ProjectStoreState['revisions'] {
  const next_section_revisions: ProjectStoreSectionRevisions = {
    ...args.currentRevisions.sections,
  }

  for (const [section, revision] of Object.entries(args.sectionRevisions ?? {})) {
    if (!isProjectStoreStage(section)) {
      continue
    }

    const normalized_revision = Number(revision)
    if (!Number.isFinite(normalized_revision)) {
      continue
    }

    next_section_revisions[section] = Math.max(
      next_section_revisions[section] ?? 0,
      normalized_revision,
    )
  }

  for (const section of args.updatedSections) {
    if (args.sectionRevisions?.[section] !== undefined) {
      continue
    }

    next_section_revisions[section] = (next_section_revisions[section] ?? 0) + 1
  }

  return {
    projectRevision: Math.max(
      args.currentRevisions.projectRevision,
      args.projectRevision,
    ),
    sections: next_section_revisions,
  }
}

function resolveExactPatchRevisions(args: {
  currentRevisions: ProjectStoreState['revisions']
  projectRevision: number
  updatedSections: ProjectStoreStage[]
  sectionRevisions?: ProjectStoreSectionRevisions
}): ProjectStoreState['revisions'] {
  const next_section_revisions: ProjectStoreSectionRevisions = {
    ...args.currentRevisions.sections,
  }

  for (const section of args.updatedSections) {
    const explicit_revision = args.sectionRevisions?.[section]
    next_section_revisions[section] = explicit_revision ?? (
      (next_section_revisions[section] ?? 0) + 1
    )
  }

  return {
    projectRevision: Number.isFinite(args.projectRevision)
      ? args.projectRevision
      : args.currentRevisions.projectRevision,
    sections: next_section_revisions,
  }
}

function normalizeRecordKey(
  value: Record<string, unknown>,
  preferred_keys: string[],
): string | null {
  for (const key of preferred_keys) {
    const raw_value = value[key]
    if (raw_value === undefined || raw_value === null) {
      continue
    }

    const normalized_value = String(raw_value).trim()
    if (normalized_value !== '') {
      return normalized_value
    }
  }

  return null
}

function mergeSectionRecords(args: {
  currentRecords: Record<string, unknown>
  values: Array<Record<string, unknown>>
  preferredKeys: string[]
}): Record<string, unknown> {
  const next_records = {
    ...args.currentRecords,
  }

  for (const value of args.values) {
    const record_key = normalizeRecordKey(value, args.preferredKeys)
    if (record_key === null) {
      continue
    }

    next_records[record_key] = value
  }

  return next_records
}

function normalizeQualityRuleSlice(
  value: ProjectStoreQualityRuleSlice | Record<string, unknown> | undefined,
): ProjectStoreQualityRuleSlice {
  if (value === undefined || value === null) {
    return createEmptyQualityRuleSlice()
  }

  const candidate = value as {
    entries?: unknown
    enabled?: unknown
    mode?: unknown
    revision?: unknown
  }

  return {
    entries: Array.isArray(candidate.entries)
      ? candidate.entries.flatMap((entry) => {
          return typeof entry === 'object' && entry !== null
            ? [{ ...(entry as Record<string, unknown>) }]
            : []
        })
      : [],
    enabled: Boolean(candidate.enabled),
    mode: String(candidate.mode ?? 'off'),
    revision: Number(candidate.revision ?? 0),
  }
}

function normalizeQualityState(
  value: ProjectStoreQualityState | Record<string, unknown> | undefined,
): ProjectStoreQualityState {
  const candidate = value as Record<string, unknown> | undefined

  return {
    glossary: normalizeQualityRuleSlice(candidate?.glossary as ProjectStoreQualityRuleSlice | undefined),
    pre_replacement: normalizeQualityRuleSlice(
      candidate?.pre_replacement as ProjectStoreQualityRuleSlice | undefined,
    ),
    post_replacement: normalizeQualityRuleSlice(
      candidate?.post_replacement as ProjectStoreQualityRuleSlice | undefined,
    ),
    text_preserve: normalizeQualityRuleSlice(
      candidate?.text_preserve as ProjectStoreQualityRuleSlice | undefined,
    ),
  }
}

function normalizePromptSlice(
  value: ProjectStorePromptSlice | Record<string, unknown> | undefined,
): ProjectStorePromptSlice {
  if (value === undefined || value === null) {
    return {
      text: '',
      enabled: false,
      revision: 0,
    }
  }

  const candidate = value as {
    text?: unknown
    enabled?: unknown
    revision?: unknown
    meta?: {
      enabled?: unknown
    }
  }

  return {
    text: String(candidate.text ?? ''),
    enabled: Boolean(candidate.enabled ?? candidate.meta?.enabled),
    revision: Number(candidate.revision ?? 0),
  }
}

function normalizePromptsState(
  value: ProjectStorePromptsState | Record<string, unknown> | undefined,
): ProjectStorePromptsState {
  const candidate = value as Record<string, unknown> | undefined

  return {
    translation: normalizePromptSlice(
      candidate?.translation as ProjectStorePromptSlice | undefined,
    ),
    analysis: normalizePromptSlice(candidate?.analysis as ProjectStorePromptSlice | undefined),
  }
}

function normalizeProofreadingState(
  value: ProjectStoreProofreadingState | Record<string, unknown> | undefined,
): ProjectStoreProofreadingState {
  if (value === undefined || value === null) {
    return createEmptyProofreadingState()
  }

  const candidate = value as {
    revision?: unknown
  }

  return {
    revision: Number(candidate.revision ?? 0),
  }
}

export function cloneProjectStoreSection<TStage extends ProjectStoreStage>(
  section: TStage,
  value: ProjectStoreSectionStateMap[TStage],
): ProjectStoreSectionStateMap[TStage] {
  if (section === 'project') {
    return {
      ...(value as ProjectStoreProjectState),
    } as ProjectStoreSectionStateMap[TStage]
  }

  if (section === 'files' || section === 'items' || section === 'analysis' || section === 'task') {
    return {
      ...(value as Record<string, unknown>),
    } as ProjectStoreSectionStateMap[TStage]
  }

  if (section === 'quality') {
    return normalizeQualityState(
      value as ProjectStoreQualityState,
    ) as ProjectStoreSectionStateMap[TStage]
  }

  if (section === 'prompts') {
    return normalizePromptsState(
      value as ProjectStorePromptsState,
    ) as ProjectStoreSectionStateMap[TStage]
  }

  return normalizeProofreadingState(
    value as ProjectStoreProofreadingState,
  ) as ProjectStoreSectionStateMap[TStage]
}

export function snapshotProjectStoreSections(
  state: ProjectStoreState,
  sections: ProjectStoreStage[],
): Partial<ProjectStoreSectionStateMap> {
  const snapshots: Partial<ProjectStoreSectionStateMap> = {}

  for (const section of sections) {
    (
      snapshots as Record<ProjectStoreStage, ProjectStoreSectionStateMap[ProjectStoreStage]>
    )[section] = cloneProjectStoreSection(section, state[section])
  }

  return snapshots
}

export function createProjectStoreReplaceSectionPatch(
  section: Exclude<ProjectStoreStage, 'files' | 'items'>,
  value: ProjectStoreSectionStateMap[Exclude<ProjectStoreStage, 'files' | 'items'>],
): ProjectStorePatchOperation {
  if (section === 'project') {
    return {
      op: 'replace_project',
      project: cloneProjectStoreSection('project', value as ProjectStoreProjectState),
    }
  }

  if (section === 'quality') {
    return {
      op: 'replace_quality',
      quality: cloneProjectStoreSection('quality', value as ProjectStoreQualityState),
    }
  }

  if (section === 'prompts') {
    return {
      op: 'replace_prompts',
      prompts: cloneProjectStoreSection('prompts', value as ProjectStorePromptsState),
    }
  }

  if (section === 'analysis') {
    return {
      op: 'replace_analysis',
      analysis: cloneProjectStoreSection('analysis', value as Record<string, unknown>),
    }
  }

  if (section === 'proofreading') {
    return {
      op: 'replace_proofreading',
      proofreading: cloneProjectStoreSection(
        'proofreading',
        value as ProjectStoreProofreadingState,
      ),
    }
  }

  return {
    op: 'replace_task',
    task: cloneProjectStoreSection('task', value as Record<string, unknown>),
  }
}

function cloneState(state: ProjectStoreState): ProjectStoreState {
  return {
    project: cloneProjectStoreSection('project', state.project),
    files: cloneProjectStoreSection('files', state.files),
    items: cloneProjectStoreSection('items', state.items),
    quality: cloneProjectStoreSection('quality', state.quality),
    prompts: cloneProjectStoreSection('prompts', state.prompts),
    analysis: cloneProjectStoreSection('analysis', state.analysis),
    proofreading: cloneProjectStoreSection('proofreading', state.proofreading),
    task: cloneProjectStoreSection('task', state.task),
    revisions: {
      projectRevision: state.revisions.projectRevision,
      sections: {
        ...state.revisions.sections,
      },
    },
  }
}

export function createProjectStore(): ProjectStoreApi {
  let state = cloneState(INITIAL_STATE)
  const listeners = new Set<ProjectStoreListener>()

  function notifyListeners(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    getState(): ProjectStoreState {
      return state
    },
    subscribe(listener: ProjectStoreListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset(): void {
      state = cloneState(INITIAL_STATE)
      notifyListeners()
    },
    applyBootstrapStage(
      stage: ProjectStoreStage,
      payload: ProjectStoreBootstrapPayload,
    ): void {
      const next_state: ProjectStoreState = {
        ...state,
        revisions: mergeRevisions(state.revisions, payload.revisions),
      }

      if (stage === 'project' && payload.project !== undefined) {
        next_state.project = payload.project
      } else if (stage === 'files' && payload.files !== undefined) {
        next_state.files = payload.files
      } else if (stage === 'items' && payload.items !== undefined) {
        next_state.items = payload.items
      } else if (stage === 'quality' && payload.quality !== undefined) {
        next_state.quality = normalizeQualityState(payload.quality)
      } else if (stage === 'prompts' && payload.prompts !== undefined) {
        next_state.prompts = normalizePromptsState(payload.prompts)
      } else if (stage === 'analysis' && payload.analysis !== undefined) {
        next_state.analysis = payload.analysis
      } else if (stage === 'proofreading' && payload.proofreading !== undefined) {
        next_state.proofreading = normalizeProofreadingState(payload.proofreading)
      } else if (stage === 'task' && payload.task !== undefined) {
        next_state.task = payload.task
      }

      state = next_state
      notifyListeners()
    },
    applyProjectPatch(
      event: ProjectStorePatchEvent,
      options?: ProjectStorePatchOptions,
    ): void {
      const revision_mode = options?.revisionMode ?? 'merge'
      const next_state: ProjectStoreState = {
        ...state,
        revisions: revision_mode === 'exact'
          ? resolveExactPatchRevisions({
              currentRevisions: state.revisions,
              projectRevision: event.projectRevision,
              updatedSections: event.updatedSections,
              sectionRevisions: event.sectionRevisions,
            })
          : mergePatchRevisions({
              currentRevisions: state.revisions,
              projectRevision: event.projectRevision,
              updatedSections: event.updatedSections,
              sectionRevisions: event.sectionRevisions,
            }),
      }

      for (const operation of event.patch) {
        if (operation.op === 'merge_files') {
          next_state.files = mergeSectionRecords({
            currentRecords: next_state.files,
            values: operation.files ?? [],
            preferredKeys: ['rel_path', 'file_path'],
          })
          continue
        }

        if (operation.op === 'merge_items') {
          next_state.items = mergeSectionRecords({
            currentRecords: next_state.items,
            values: operation.items ?? [],
            preferredKeys: ['item_id'],
          })
          continue
        }

        if (operation.op === 'replace_project' && operation.project !== undefined) {
          next_state.project = operation.project
          continue
        }

        if (operation.op === 'replace_quality' && operation.quality !== undefined) {
          next_state.quality = normalizeQualityState(operation.quality)
          continue
        }

        if (operation.op === 'replace_prompts' && operation.prompts !== undefined) {
          next_state.prompts = normalizePromptsState(operation.prompts)
          continue
        }

        if (operation.op === 'replace_analysis' && operation.analysis !== undefined) {
          next_state.analysis = operation.analysis
          continue
        }

        if (operation.op === 'replace_proofreading' && operation.proofreading !== undefined) {
          next_state.proofreading = normalizeProofreadingState(operation.proofreading)
          continue
        }

        if (operation.op === 'replace_task' && operation.task !== undefined) {
          next_state.task = operation.task
        }
      }

      state = next_state
      notifyListeners()
    },
  }
}

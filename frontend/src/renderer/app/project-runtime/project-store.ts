export type ProjectStoreStage =
  | 'project'
  | 'files'
  | 'items'
  | 'quality'
  | 'prompts'
  | 'analysis'
  | 'task'

export type ProjectStoreSectionRevisions = Partial<Record<ProjectStoreStage, number>>

export type ProjectStoreState = {
  project: {
    path: string
    loaded: boolean
  }
  files: Record<string, unknown>
  items: Record<string, unknown>
  quality: Record<string, unknown>
  prompts: Record<string, unknown>
  analysis: Record<string, unknown>
  task: Record<string, unknown>
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
    | 'replace_task'
  project?: ProjectStoreState['project']
  quality?: ProjectStoreState['quality']
  prompts?: ProjectStoreState['prompts']
  analysis?: ProjectStoreState['analysis']
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

export function isProjectStoreStage(value: string): value is ProjectStoreStage {
  return [
    'project',
    'files',
    'items',
    'quality',
    'prompts',
    'analysis',
    'task',
  ].includes(value)
}

type ProjectStoreApi = {
  getState: () => ProjectStoreState
  applyBootstrapStage: (
    stage: ProjectStoreStage,
    payload: ProjectStoreBootstrapPayload,
  ) => void
  applyProjectPatch: (event: ProjectStorePatchEvent) => void
}

const INITIAL_STATE: ProjectStoreState = {
  project: {
    path: '',
    loaded: false,
  },
  files: {},
  items: {},
  quality: {},
  prompts: {},
  analysis: {},
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
    ...args.sectionRevisions,
  }

  for (const section of args.updatedSections) {
    if (args.sectionRevisions?.[section] !== undefined) {
      continue
    }

    next_section_revisions[section] = (next_section_revisions[section] ?? 0) + 1
  }

  return {
    projectRevision: args.projectRevision,
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

export function createProjectStore(): ProjectStoreApi {
  let state = INITIAL_STATE

  return {
    getState(): ProjectStoreState {
      return state
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
        next_state.quality = payload.quality
      } else if (stage === 'prompts' && payload.prompts !== undefined) {
        next_state.prompts = payload.prompts
      } else if (stage === 'analysis' && payload.analysis !== undefined) {
        next_state.analysis = payload.analysis
      } else if (stage === 'task' && payload.task !== undefined) {
        next_state.task = payload.task
      }

      state = next_state
    },
    applyProjectPatch(event: ProjectStorePatchEvent): void {
      const next_state: ProjectStoreState = {
        ...state,
        revisions: mergePatchRevisions({
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
          next_state.quality = operation.quality
          continue
        }

        if (operation.op === 'replace_prompts' && operation.prompts !== undefined) {
          next_state.prompts = operation.prompts
          continue
        }

        if (operation.op === 'replace_analysis' && operation.analysis !== undefined) {
          next_state.analysis = operation.analysis
          continue
        }

        if (operation.op === 'replace_task' && operation.task !== undefined) {
          next_state.task = operation.task
        }
      }

      state = next_state
    },
  }
}

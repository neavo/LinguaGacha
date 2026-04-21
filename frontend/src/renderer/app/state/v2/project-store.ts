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
  pendingMutations: string[]
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
  pendingMutations: [],
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
  }
}

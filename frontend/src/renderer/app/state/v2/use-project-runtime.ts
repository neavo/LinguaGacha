import {
  consumeBootstrapStream,
  type BootstrapStreamEvent,
} from './bootstrap-stream'
import {
  type ProjectStoreBootstrapPayload,
  type ProjectStoreStage,
  isProjectStoreStage,
} from './project-store'

type ProjectStoreApi = {
  applyBootstrapStage: (
    stage: ProjectStoreStage,
    payload: ProjectStoreBootstrapPayload,
  ) => void
}

type V2ProjectRuntimeArgs = {
  store: ProjectStoreApi
  openBootstrapStream: (projectPath: string) => AsyncIterable<BootstrapStreamEvent>
}

export function createV2ProjectRuntime(args: V2ProjectRuntimeArgs) {
  return {
    async bootstrap(projectPath: string): Promise<void> {
      const normalized_project_path = projectPath.trim()
      if (normalized_project_path === '') {
        return
      }

      await consumeBootstrapStream({
        open: () => args.openBootstrapStream(normalized_project_path),
        onStagePayload: (stage, payload) => {
          if (!isProjectStoreStage(stage)) {
            return
          }

          args.store.applyBootstrapStage(
            stage,
            payload as ProjectStoreBootstrapPayload,
          )
        },
      })
    },
  }
}

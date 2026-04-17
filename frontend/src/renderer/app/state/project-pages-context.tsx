/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'

import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { useProofreadingPageState } from '@/pages/proofreading-page/use-proofreading-page-state'
import { useWorkbenchLiveState } from '@/pages/workbench-page/use-workbench-live-state'

type ProjectPagesContextValue = {
  proofreading_page_state: ReturnType<typeof useProofreadingPageState>
  workbench_live_state: ReturnType<typeof useWorkbenchLiveState>
}

const ProjectPagesContext = createContext<ProjectPagesContextValue | null>(null)

export function ProjectPagesProvider(props: { children: ReactNode }): JSX.Element {
  const {
    project_snapshot,
    set_project_warmup_status,
  } = useDesktopRuntime()
  const proofreading_page_state = useProofreadingPageState()
  const workbench_live_state = useWorkbenchLiveState()
  const previous_project_loaded_ref = useRef(project_snapshot.loaded)
  const previous_project_path_ref = useRef(project_snapshot.path)
  const warmup_target_project_path_ref = useRef('')

  const proofreading_warmup_ready = project_snapshot.loaded
    && !proofreading_page_state.is_refreshing
    && proofreading_page_state.settled_project_path === project_snapshot.path
  const workbench_warmup_ready = project_snapshot.loaded
    && !workbench_live_state.is_refreshing
    && workbench_live_state.settled_project_path === project_snapshot.path

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current
    const previous_project_path = previous_project_path_ref.current

    previous_project_loaded_ref.current = project_snapshot.loaded
    previous_project_path_ref.current = project_snapshot.path

    if (!project_snapshot.loaded) {
      warmup_target_project_path_ref.current = ''
      set_project_warmup_status('idle')
      return
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      warmup_target_project_path_ref.current = project_snapshot.path
      set_project_warmup_status('warming')
    }
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    set_project_warmup_status,
  ])

  useEffect(() => {
    if (!project_snapshot.loaded) {
      return
    }

    const warmup_target_project_path = warmup_target_project_path_ref.current
    if (
      warmup_target_project_path === ''
      || warmup_target_project_path !== project_snapshot.path
    ) {
      return
    }

    if (proofreading_warmup_ready && workbench_warmup_ready) {
      warmup_target_project_path_ref.current = ''
      set_project_warmup_status('ready')
    }
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    proofreading_warmup_ready,
    set_project_warmup_status,
    workbench_warmup_ready,
  ])

  const context_value = useMemo<ProjectPagesContextValue>(() => {
    return {
      proofreading_page_state,
      workbench_live_state,
    }
  }, [proofreading_page_state, workbench_live_state])

  return (
    <ProjectPagesContext.Provider value={context_value}>
      {props.children}
    </ProjectPagesContext.Provider>
  )
}

function useProjectPagesContext(): ProjectPagesContextValue {
  const context_value = useContext(ProjectPagesContext)

  if (context_value === null) {
    throw new Error('useProjectPagesContext 必须在 ProjectPagesProvider 内使用。')
  }

  return context_value
}

export function useCachedProofreadingPageState(): ReturnType<typeof useProofreadingPageState> {
  return useProjectPagesContext().proofreading_page_state
}

export function useCachedWorkbenchLiveState(): ReturnType<typeof useWorkbenchLiveState> {
  return useProjectPagesContext().workbench_live_state
}

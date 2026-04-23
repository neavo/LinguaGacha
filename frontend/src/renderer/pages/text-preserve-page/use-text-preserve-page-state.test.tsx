// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTextPreservePageState } from './use-text-preserve-page-state'

const {
  api_fetch_mock,
  push_toast_mock,
  wait_for_barrier_mock,
  create_barrier_checkpoint_mock,
} = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
    wait_for_barrier_mock: vi.fn(),
    create_barrier_checkpoint_mock: vi.fn(),
  }
})

const run_modal_progress_toast_mock = vi.fn(async <T,>(args: {
  message: string
  task: () => Promise<T>
  timeout_ms?: number
}): Promise<T> => {
  if (args.timeout_ms === undefined) {
    return args.task()
  }

  return await Promise.race([
    args.task(),
    new Promise<T>((_resolve, reject) => {
      window.setTimeout(() => {
        reject(new Error('模态进度通知等待超时。'))
      }, args.timeout_ms)
    }),
  ])
})

const runtime_state = {
  quality: {
    glossary: { entries: [], enabled: true, mode: 'off', revision: 0 },
    pre_replacement: { entries: [], enabled: true, mode: 'off', revision: 0 },
    post_replacement: { entries: [], enabled: true, mode: 'off', revision: 0 },
    text_preserve: {
      entries: [
        {
          src: 'foo',
          info: 'bar',
        },
      ],
      enabled: true,
      mode: 'custom',
      revision: 1,
    },
  },
}

const project_store_listeners = new Set<() => void>()

function notify_project_store(): void {
  for (const listener of project_store_listeners) {
    listener()
  }
}

const project_store = {
  subscribe: (listener: () => void) => {
    project_store_listeners.add(listener)
    return () => {
      project_store_listeners.delete(listener)
    }
  },
  getState: () => runtime_state,
}

vi.mock('@/app/desktop-api', () => {
  return {
    api_fetch: api_fetch_mock,
  }
})

vi.mock('@/app/state/project-pages-context', () => {
  return {
    useProjectPagesBarrier: () => ({
      create_barrier_checkpoint: create_barrier_checkpoint_mock,
      wait_for_barrier: wait_for_barrier_mock,
    }),
  }
})

vi.mock('@/app/navigation/navigation-context', () => {
  return {
    useAppNavigation: () => ({
      navigate_to_route: vi.fn(),
      push_proofreading_lookup_intent: vi.fn(),
    }),
  }
})

vi.mock('@/app/state/use-desktop-runtime', () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: {
        loaded: true,
        path: 'E:/demo/sample.lg',
      },
      project_store,
      settings_snapshot: {},
      set_settings_snapshot: vi.fn(),
      commit_local_project_patch: (input: {
        patch: Array<{ op: string; quality?: typeof runtime_state.quality }>
      }) => {
        const previous_quality = {
          ...runtime_state.quality,
          text_preserve: {
            ...runtime_state.quality.text_preserve,
            entries: runtime_state.quality.text_preserve.entries.map((entry) => ({ ...entry })),
          },
        }
        const quality_patch = input.patch.find((operation) => operation.op === 'replace_quality')
        if (quality_patch?.quality !== undefined) {
          runtime_state.quality = quality_patch.quality
          notify_project_store()
        }

        return {
          previousProjectRevision: 0,
          previousSectionRevisions: { quality: 0 },
          previousSections: { quality: previous_quality },
          rollback: () => {
            runtime_state.quality = previous_quality
            notify_project_store()
          },
        }
      },
    }),
  }
})

vi.mock('@/app/state/use-desktop-toast', () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
      run_modal_progress_toast: run_modal_progress_toast_mock,
    }),
  }
})

vi.mock('@/i18n', () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  }
})

function flush_microtasks(): Promise<void> {
  return act(async () => {
    await Promise.resolve()
  })
}

function Probe(props: {
  on_ready: (state: ReturnType<typeof useTextPreservePageState>) => void
}): JSX.Element | null {
  const state = useTextPreservePageState()

  useEffect(() => {
    props.on_ready(state)
  }, [props, state])

  return null
}

describe('useTextPreservePageState', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let latest_state: ReturnType<typeof useTextPreservePageState> | null = null

  beforeEach(() => {
    project_store_listeners.clear()
    create_barrier_checkpoint_mock.mockReturnValue({
      projectPath: 'E:/demo/sample.lg',
      proofreadingLastLoadedAt: 1,
      workbenchLastLoadedAt: 1,
    })
    runtime_state.quality.text_preserve = {
      entries: [
        {
          src: 'foo',
          info: 'bar',
        },
      ],
      enabled: true,
      mode: 'custom',
      revision: 1,
    }
  })

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount()
      })
    }

    vi.useRealTimers()
    container?.remove()
    container = null
    root = null
    latest_state = null
    api_fetch_mock.mockReset()
    push_toast_mock.mockReset()
    wait_for_barrier_mock.mockReset()
    create_barrier_checkpoint_mock.mockReset()
    run_modal_progress_toast_mock.mockClear()
  })

  async function mount_probe(): Promise<void> {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <Probe
          on_ready={(state) => {
            latest_state = state
          }}
        />,
      )
    })
  }

  it('在校对缓存等待超时时保留已提交的模式并提示稍后刷新', async () => {
    vi.useFakeTimers()
    wait_for_barrier_mock.mockImplementation(async () => {
      return await new Promise<void>(() => {})
    })
    api_fetch_mock.mockResolvedValue({
      accepted: true,
    })

    await mount_probe()
    if (latest_state === null) {
      throw new Error('文本保护页面状态未准备就绪。')
    }

    const update_promise = latest_state.update_mode('smart')
    await flush_microtasks()

    await act(async () => {
      vi.advanceTimersByTime(20000)
      await update_promise
    })

    expect(latest_state?.mode).toBe('smart')
    expect(latest_state?.mode_updating).toBe(false)
    expect(push_toast_mock).toHaveBeenCalledWith(
      'warning',
      'text_preserve_page.feedback.mode_refresh_pending',
    )
  })

  it('在模式切换进行中忽略后续重复点击', async () => {
    const barrier_deferred: { resolve: () => void } = {
      resolve: () => {},
    }
    wait_for_barrier_mock.mockImplementation(async () => {
      return await new Promise<void>((resolve) => {
        barrier_deferred.resolve = resolve
      })
    })
    api_fetch_mock.mockResolvedValue({
      accepted: true,
    })

    await mount_probe()
    if (latest_state === null) {
      throw new Error('文本保护页面状态未准备就绪。')
    }

    const first_update = latest_state.update_mode('smart')
    await flush_microtasks()
    const second_update = latest_state.update_mode('off')
    await flush_microtasks()

    expect(api_fetch_mock).toHaveBeenCalledTimes(1)
    expect(latest_state?.mode_updating).toBe(true)

    barrier_deferred.resolve()

    await act(async () => {
      await first_update
      await second_update
    })

    expect(latest_state?.mode).toBe('smart')
    expect(latest_state?.mode_updating).toBe(false)
  })
})

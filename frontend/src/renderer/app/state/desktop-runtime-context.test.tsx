// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DesktopRuntimeProvider } from '@/app/state/desktop-runtime-context'
import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'

const {
  api_fetch_mock,
  open_v2_event_stream_mock,
  open_v2_project_bootstrap_stream_mock,
} = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    open_v2_event_stream_mock: vi.fn(),
    open_v2_project_bootstrap_stream_mock: vi.fn(),
  }
})

vi.mock('@/app/desktop-api', () => {
  return {
    api_fetch: api_fetch_mock,
    open_v2_event_stream: open_v2_event_stream_mock,
    open_v2_project_bootstrap_stream: open_v2_project_bootstrap_stream_mock,
  }
})

type RuntimeSnapshot = {
  workbenchSeq: number
  workbenchReason: string
  proofreadingSeq: number
  proofreadingReason: string
  fileKeys: string[]
  itemKeys: string[]
}

function RuntimeProbe(props: {
  onSnapshot: (snapshot: RuntimeSnapshot) => void
}): JSX.Element | null {
  const runtime = useDesktopRuntime()

  useEffect(() => {
    props.onSnapshot({
      workbenchSeq: runtime.workbench_change_signal.seq,
      workbenchReason: runtime.workbench_change_signal.reason,
      proofreadingSeq: runtime.proofreading_change_signal.seq,
      proofreadingReason: runtime.proofreading_change_signal.reason,
      fileKeys: Object.keys(runtime.project_store.getState().files),
      itemKeys: Object.keys(runtime.project_store.getState().items),
    })
  }, [
    props,
    runtime.proofreading_change_signal.reason,
    runtime.proofreading_change_signal.seq,
    runtime.project_store,
    runtime.workbench_change_signal.reason,
    runtime.workbench_change_signal.seq,
  ])

  return null
}

async function wait_for_condition(
  predicate: () => boolean,
  attempts = 20,
): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return
    }

    await act(async () => {
      await Promise.resolve()
    })
  }

  throw new Error('等待运行时状态收敛失败。')
}

function create_event_source_stub(): {
  event_source: EventSource
  emit: (event_name: string, payload: Record<string, unknown>) => void
} {
  const listener_map = new Map<string, EventListener>()

  return {
    event_source: {
      addEventListener: vi.fn((event_name: string, listener: EventListener) => {
        listener_map.set(event_name, listener)
      }),
      close: vi.fn(),
      onerror: null,
    } as unknown as EventSource,
    emit: (event_name: string, payload: Record<string, unknown>) => {
      const listener = listener_map.get(event_name)
      if (listener === undefined) {
        throw new Error(`缺少事件监听器：${event_name}`)
      }

      listener({
        data: JSON.stringify(payload),
      } as MessageEvent<string>)
    },
  }
}

describe('DesktopRuntimeProvider', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount()
      })
    }

    container?.remove()
    root = null
    container = null
    api_fetch_mock.mockReset()
    open_v2_event_stream_mock.mockReset()
    open_v2_project_bootstrap_stream_mock.mockReset()
  })

  it('完成 bootstrap 后补发工作台与校对页刷新信号', async () => {
    const snapshots: RuntimeSnapshot[] = []
    const event_stream = create_event_source_stub()

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === '/api/settings/app') {
        return {
          settings: {
            app_language: 'ZH',
          },
        }
      }

      if (path === '/api/v2/project/snapshot') {
        return {
          project: {
            path: 'E:/demo/demo.lg',
            loaded: true,
          },
        }
      }

      if (path === '/api/v2/tasks/snapshot') {
        return {
          task: {
            task_type: 'translation',
            status: 'IDLE',
            busy: false,
          },
        }
      }

      throw new Error(`未预期的请求：${path}`)
    })

    open_v2_event_stream_mock.mockResolvedValue(event_stream.event_source)

    open_v2_project_bootstrap_stream_mock.mockImplementation(() => {
      return (async function* () {
        yield {
          type: 'stage_payload',
          stage: 'files',
          payload: {
            fields: ['rel_path', 'file_type'],
            rows: [['chapter01.txt', 'TXT']],
          },
        }
        yield {
          type: 'stage_payload',
          stage: 'items',
          payload: {
            fields: ['item_id', 'file_path', 'status'],
            rows: [[1, 'chapter01.txt', 'DONE']],
          },
        }
        yield {
          type: 'completed',
          projectRevision: 4,
          sectionRevisions: {
            files: 2,
            items: 3,
          },
        }
      })()
    })

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot)
            }}
          />
        </DesktopRuntimeProvider>,
      )
    })

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1)
      return latest_snapshot?.workbenchSeq === 1 && latest_snapshot.proofreadingSeq === 1
    })

    const latest_snapshot = snapshots.at(-1)

    expect(open_v2_project_bootstrap_stream_mock).toHaveBeenCalledWith()
    expect(latest_snapshot).toMatchObject({
      workbenchSeq: 1,
      workbenchReason: 'project_bootstrap',
      proofreadingSeq: 1,
      proofreadingReason: 'project_bootstrap',
      fileKeys: ['chapter01.txt'],
      itemKeys: ['1'],
    })
  })

  it('source_language 设置变更会触发项目缓存刷新信号', async () => {
    const snapshots: RuntimeSnapshot[] = []
    const event_stream = create_event_source_stub()

    api_fetch_mock.mockImplementation(async (path: string) => {
      if (path === '/api/settings/app') {
        return {
          settings: {
            app_language: 'ZH',
            source_language: 'JA',
          },
        }
      }

      if (path === '/api/v2/project/snapshot') {
        return {
          project: {
            path: 'E:/demo/demo.lg',
            loaded: true,
          },
        }
      }

      if (path === '/api/v2/tasks/snapshot') {
        return {
          task: {
            task_type: 'translation',
            status: 'IDLE',
            busy: false,
          },
        }
      }

      throw new Error(`未预期的请求：${path}`)
    })

    open_v2_event_stream_mock.mockResolvedValue(event_stream.event_source)
    open_v2_project_bootstrap_stream_mock.mockImplementation(() => {
      return (async function* () {
        yield {
          type: 'completed',
          projectRevision: 1,
          sectionRevisions: {},
        }
      })()
    })

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <DesktopRuntimeProvider>
          <RuntimeProbe
            onSnapshot={(snapshot) => {
              snapshots.push(snapshot)
            }}
          />
        </DesktopRuntimeProvider>,
      )
    })

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1)
      return latest_snapshot?.workbenchSeq === 1 && latest_snapshot?.proofreadingSeq === 1
    })

    await act(async () => {
      event_stream.emit('settings.changed', {
        keys: ['source_language'],
        settings: {
          source_language: 'EN',
        },
      })
      await Promise.resolve()
    })

    await wait_for_condition(() => {
      const latest_snapshot = snapshots.at(-1)
      return latest_snapshot?.workbenchSeq === 2 && latest_snapshot?.proofreadingSeq === 2
    })

    const latest_snapshot = snapshots.at(-1)

    expect(latest_snapshot).toMatchObject({
      workbenchSeq: 2,
      workbenchReason: 'config_updated',
      proofreadingSeq: 2,
      proofreadingReason: 'config_updated',
    })
  })
})

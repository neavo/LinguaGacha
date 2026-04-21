import { describe, expect, it } from 'vitest'

import { consumeBootstrapStream } from './bootstrap-stream'

describe('consumeBootstrapStream', () => {
  it('按 stage 顺序把 payload 写入 store', async () => {
    const applied: string[] = []

    await consumeBootstrapStream({
      open: async function* () {
        yield {
          type: 'stage_payload',
          stage: 'project',
          payload: {
            project: {
              path: 'demo',
              loaded: true,
            },
          },
        }
        yield {
          type: 'completed',
          projectRevision: 1,
          sectionRevisions: {
            project: 1,
          },
        }
      },
      onStagePayload: (stage) => {
        applied.push(stage)
      },
    })

    expect(applied).toEqual(['project'])
  })

  it('把 completed 事件中的 revision 透传给调用方', async () => {
    const completed_events: Array<{
      projectRevision: number
      sectionRevisions: Record<string, number>
    }> = []

    await consumeBootstrapStream({
      open: async function* () {
        yield {
          type: 'completed',
          projectRevision: 7,
          sectionRevisions: {
            project: 1,
            items: 4,
          },
        }
      },
      onStagePayload: () => {},
      onCompleted: (projectRevision, sectionRevisions) => {
        completed_events.push({
          projectRevision,
          sectionRevisions,
        })
      },
    })

    expect(completed_events).toEqual([
      {
        projectRevision: 7,
        sectionRevisions: {
          project: 1,
          items: 4,
        },
      },
    ])
  })
})

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
})

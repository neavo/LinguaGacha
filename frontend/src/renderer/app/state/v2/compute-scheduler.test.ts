import { describe, expect, it } from 'vitest'

import { ComputeScheduler } from './compute-scheduler'

describe('ComputeScheduler', () => {
  it('取消旧的校对任务结果', async () => {
    const deferred = {
      resolve: null as ((value: { warningMap: Record<string, string[]> }) => void) | null,
    }
    const scheduler = new ComputeScheduler({
      executeProofreadingTask: (async () => {
        return new Promise<{ warningMap: Record<string, string[]> }>((resolve) => {
          deferred.resolve = resolve
        })
      }) as typeof import('./workers/proofreading-worker').runProofreadingWorkerTask,
    })

    const first_task = scheduler.runProofreadingTask({
      items: [],
      glossary: [],
      config: {
        source_language: 'JA',
        check_similarity: true,
      },
    })

    scheduler.cancelProofreadingTask()
    if (deferred.resolve === null) {
      throw new Error('缺少首个任务的 resolver。')
    }
    deferred.resolve({
      warningMap: {
        '1': ['SIMILARITY'],
      },
    })

    await expect(first_task).resolves.toEqual({
      cancelled: true,
      warningMap: {},
    })
  })
})
